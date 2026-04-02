import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { availableParallelism, cpus } from 'os';
import { RARITY_WEIGHTS, diagnostics } from './constants.mjs';
import { findBunBinary } from './patcher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'finder-worker.mjs');

// Calculate expected attempts based on probability of matching all desired traits.
export function estimateAttempts(desired) {
  // Species: 1/18
  let p = 1 / 18;

  // Rarity: weight / 100
  p *= RARITY_WEIGHTS[desired.rarity] / 100;

  // Eye: 1/6
  p *= 1 / 6;

  // Hat: common is always 'none' (guaranteed), otherwise 1/8
  if (desired.rarity !== 'common') {
    p *= 1 / 8;
  }

  // Shiny: 1/100
  if (desired.shiny) {
    p *= 0.01;
  }

  // Peak stat: 1/5
  if (desired.peak) {
    p *= 1 / 5;
  }

  // Dump stat: ~1/4 (picked from remaining 4, but rerolls on collision)
  if (desired.dump) {
    p *= 1 / 4;
  }

  // Expected attempts = 1/p (geometric distribution)
  return Math.round(1 / p);
}

// Determine how many parallel workers to spawn.
function getWorkerCount() {
  const cores = typeof availableParallelism === 'function'
    ? availableParallelism()
    : cpus().length;
  // Cap at 8: diminishing returns beyond this, leaves cores free for the user
  return Math.max(1, Math.min(cores, 8));
}

// Spawns parallel Bun subprocesses that brute-force salts using native Bun.hash.
// Calls onProgress with { attempts, elapsed, rate, expected, pct, eta } on each tick.
// Returns a promise resolving to { salt, attempts, elapsed }.
export function findSalt(userId, desired, { onProgress } = {}) {
  const expected = estimateAttempts(desired);
  const bunBinary = findBunBinary();
  const workerCount = getWorkerCount();

  return new Promise((resolve, reject) => {
    const args = [
      WORKER_PATH,
      userId,
      desired.species,
      desired.rarity,
      desired.eye,
      desired.hat,
      String(desired.shiny ?? false),
      desired.peak ?? 'any',
      desired.dump ?? 'any',
    ];

    // Scale timeout with expected attempts: 10 min base, +1 min per 50M attempts
    const timeout = Math.max(600000, Math.ceil(expected / 50_000_000) * 60_000 + 600_000);

    const ac = new AbortController();
    const { signal } = ac;

    // Per-worker tracking for progress aggregation and failure diagnostics
    // When using multiple workers, attempts is approximate: the winner's count is exact,
    const workerAttempts = new Array(workerCount).fill(0);
    const workerElapsed = new Array(workerCount).fill(0);
    const workerErrors = new Array(workerCount).fill('');
    const workerDone = new Array(workerCount).fill(false);
    const workerExits = new Array(workerCount).fill(null);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ac.abort();
        const extra = {
          Bun: bunBinary,
          Workers: workerCount,
          Expected: `~${expected.toLocaleString()} attempts`,
          Timeout: `${(timeout / 1000).toFixed(0)}s`,
        };
        reject(new Error(`Salt finder timed out\n\n${diagnostics(extra)}`));
      }
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      ac.abort();
    }

    for (let i = 0; i < workerCount; i++) {
      const child = spawn(bunBinary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        signal,
      });

      let stdout = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        if (settled) return;
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const progress = JSON.parse(line);
            workerAttempts[i] = progress.attempts;
            workerElapsed[i] = progress.elapsed;

            if (onProgress) {
              const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
              const maxElapsed = Math.max(...workerElapsed);
              const rate = maxElapsed > 0 ? totalAttempts / (maxElapsed / 1000) : 0;
              const pct = Math.min(100, (totalAttempts / expected) * 100);
              const remaining = Math.max(0, expected - totalAttempts);
              const eta = rate > 0 ? remaining / rate : Infinity;
              onProgress({ attempts: totalAttempts, elapsed: maxElapsed, rate, expected, pct, eta });
            }
          } catch {
            // Not JSON — capture for failure diagnostics
            workerErrors[i] += line + '\n';
          }
        }
      });

      child.on('close', (code, sig) => {
        if (workerDone[i]) return;
        workerDone[i] = true;
        workerExits[i] = { code, sig };
        if (settled) return;

        if (code === 0 && stdout.trim()) {
          try {
            const result = JSON.parse(stdout.trim());
            // Use the winner's authoritative count, plus other workers' last checkpoints
            workerAttempts[i] = result.attempts;
            workerElapsed[i] = result.elapsed;
            settled = true;
            cleanup();
            resolve({
              salt: result.salt,
              attempts: workerAttempts.reduce((a, b) => a + b, 0),
              elapsed: Math.max(...workerElapsed),
            });
            return;
          } catch {
            // Malformed stdout — let other workers continue
          }
        }

        // All workers exited without finding a match
        if (workerDone.every(Boolean)) {
          settled = true;
          cleanup();
          // Prefer the first genuine failure (non-zero exit, not killed by our abort)
          const root = workerExits.find(e => e && e.code !== 0 && !e.sig) ?? workerExits.find(e => e) ?? { code, sig };
          const reason = root.sig ? `killed by ${root.sig}` : `exited with code ${root.code}`;
          const stderrClean = workerErrors
            .map((s, idx) => s.trim() ? `[worker ${idx}] ${s.trim()}` : '')
            .filter(Boolean).join('\n');
          const extra = {
            Bun: bunBinary,
            Workers: workerCount,
            Expected: `~${expected.toLocaleString()} attempts`,
            Timeout: `${(timeout / 1000).toFixed(0)}s`,
            Args: `[${args.slice(1).map(a => `"${a}"`).join(', ')}]`,
          };
          if (stderrClean) extra['Worker stderr'] = stderrClean;
          reject(new Error(`Salt finder ${reason}\n\n${diagnostics(extra)}`));
        }
      });

      child.on('error', (err) => {
        if (workerDone[i]) return;
        workerDone[i] = true;
        if (settled) return;

        // All workers failed to spawn
        if (workerDone.every(Boolean)) {
          settled = true;
          cleanup();
          reject(new Error(
            `Failed to spawn salt finder: ${err.message}\n\n${diagnostics({ Bun: bunBinary })}`
          ));
        }
      });
    }
  });
}
