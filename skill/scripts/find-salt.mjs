#!/usr/bin/env node
// Brute-force salt finder for Claude Code companion pet.
// Runs on Node.js — uses vendored wyhash WASM or FNV-1a (for Node-based Claude installs).
// Parallelizes across CPU cores via worker_threads for faster searches.
//
// Usage: node find-salt.mjs <userId> <species> <rarity> <eye> <hat> [shiny] [peak] [dump] [--fnv1a]
// Output: JSON on stdout { salt, attempts, totalAttempts, elapsed, workers }
// Progress: JSON on stderr periodically
//
// Pass --fnv1a when the Claude binary runs under Node (e.g., Windows npm installs).
// Without it, uses wyhash (matching Bun-based compiled binary installs).

import { isMainThread, Worker, workerData, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import os from 'os';
import {
  RARITIES, SPECIES, EYES, HATS, STAT_NAMES,
  mulberry32, pick, rollRarity, getHashFn,
} from './shared.mjs';

const SALT_LEN = 15;
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const REPORT_INTERVAL = 100_000;

function randomSalt() {
  let s = '';
  for (let i = 0; i < SALT_LEN; i++) {
    s += CHARSET[(Math.random() * CHARSET.length) | 0];
  }
  return s;
}

// ─── Worker thread ───
if (!isMainThread) {
  const data = workerData;

  const hashFn = await getHashFn(data.useFnv1a);

  let attempts = 0;
  const start = Date.now();

  while (true) {
    attempts++;
    const salt = randomSalt();
    const seed = hashFn(data.userId + salt);
    const rng = mulberry32(seed);

    // Early-exit: check each attribute immediately after rolling.
    // Skips remaining RNG calls as soon as a mismatch is found.
    do {
      const rarity = rollRarity(rng);
      if (rarity !== data.wantRarity) break;

      const species = pick(rng, SPECIES);
      if (species !== data.wantSpecies) break;

      const eye = pick(rng, EYES);
      if (eye !== data.wantEye) break;

      const hat = rarity === 'common' ? 'none' : pick(rng, HATS);
      if (hat !== data.wantHat) break;

      const shiny = rng() < 0.01;
      if (data.requireShiny && !shiny) break;

      if (data.needStats) {
        const peak = pick(rng, STAT_NAMES);
        let dump = pick(rng, STAT_NAMES);
        while (dump === peak) dump = pick(rng, STAT_NAMES);
        if (data.requirePeak && peak !== data.requirePeak) break;
        if (data.requireDump && dump !== data.requireDump) break;
      }

      // All attributes match!
      parentPort.postMessage({ type: 'result', salt, attempts, elapsed: Date.now() - start });
      process.exit(0);
    } while (false);

    if (attempts % REPORT_INTERVAL === 0) {
      parentPort.postMessage({ type: 'progress', attempts, elapsed: Date.now() - start });
    }
  }
} else {
  // ─── Main thread ───

  // Parse args (filter out --fnv1a flag)
  const useFnv1a = process.argv.includes('--fnv1a');
  const rawArgs = process.argv.slice(2).filter(a => a !== '--fnv1a');
  const [userId, wantSpecies, wantRarity, wantEye, wantHat, wantShiny, wantPeak, wantDump] = rawArgs;

  if (!userId || !wantSpecies || !wantRarity || !wantEye || !wantHat) {
    console.error('Usage: node find-salt.mjs <userId> <species> <rarity> <eye> <hat> [shiny] [peak] [dump] [--fnv1a]');
    console.error('');
    console.error('Species: ' + SPECIES.join(', '));
    console.error('Rarities: ' + RARITIES.join(', '));
    console.error('Eyes: ' + EYES.join(', '));
    console.error('Hats: ' + HATS.join(', '));
    console.error('Stats: ' + STAT_NAMES.join(', '));
    console.error('');
    console.error('Pass --fnv1a for Node-based Claude installs (Windows npm).');
    process.exit(1);
  }

  const requireShiny = wantShiny === 'true';
  const requirePeak = wantPeak && wantPeak !== 'any' ? wantPeak : null;
  const requireDump = wantDump && wantDump !== 'any' ? wantDump : null;
  const needStats = !!(requirePeak || requireDump);

  // Input validation
  const validationErrors = [];
  if (!SPECIES.includes(wantSpecies)) {
    validationErrors.push(`Invalid species "${wantSpecies}". Valid: ${SPECIES.join(', ')}`);
  }
  if (!RARITIES.includes(wantRarity)) {
    validationErrors.push(`Invalid rarity "${wantRarity}". Valid: ${RARITIES.join(', ')}`);
  }
  if (!EYES.includes(wantEye)) {
    validationErrors.push(`Invalid eye "${wantEye}". Valid: ${EYES.join(', ')}`);
  }
  if (!HATS.includes(wantHat)) {
    validationErrors.push(`Invalid hat "${wantHat}". Valid: ${HATS.join(', ')}`);
  }
  if (wantRarity === 'common' && wantHat !== 'none') {
    validationErrors.push(`Common rarity always has hat=none, but got hat="${wantHat}".`);
  }
  if (requirePeak && !STAT_NAMES.includes(requirePeak)) {
    validationErrors.push(`Invalid peak stat "${requirePeak}". Valid: ${STAT_NAMES.join(', ')}`);
  }
  if (requireDump && !STAT_NAMES.includes(requireDump)) {
    validationErrors.push(`Invalid dump stat "${requireDump}". Valid: ${STAT_NAMES.join(', ')}`);
  }
  if (requirePeak && requireDump && requirePeak === requireDump) {
    validationErrors.push(`Peak and dump stats cannot be the same ("${requirePeak}"). Peak is the highest stat, dump is the lowest.`);
  }
  if (validationErrors.length > 0) {
    process.stderr.write(JSON.stringify({ error: 'Invalid input', details: validationErrors }) + '\n');
    process.exit(1);
  }

  const MAX_ATTEMPTS = parseInt(process.env.SALT_MAX_ATTEMPTS, 10) || 50_000_000;
  // Use all available cores, capped at 8 (diminishing returns beyond this)
  const numWorkers = Math.max(1, Math.min(
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length || 4,
    8
  ));

  if (useFnv1a) {
    process.stderr.write(JSON.stringify({ info: 'Using FNV-1a hash (Node runtime detected)' }) + '\n');
  }
  process.stderr.write(JSON.stringify({ info: `Starting ${numWorkers} worker(s)` }) + '\n');

  const workerAttempts = new Array(numWorkers).fill(0);
  let resolved = false;
  let exited = 0;
  const workers = [];

  function killAll() {
    for (const w of workers) {
      try { w.terminate(); } catch { /* already dead */ }
    }
  }

  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: {
        userId, wantSpecies, wantRarity, wantEye, wantHat,
        requireShiny, requirePeak, requireDump, needStats, useFnv1a,
      },
    });

    worker.on('message', (msg) => {
      if (resolved) return;

      if (msg.type === 'result') {
        resolved = true;
        workerAttempts[i] = msg.attempts;
        const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
        console.log(JSON.stringify({
          salt: msg.salt,
          attempts: msg.attempts,
          totalAttempts: Math.max(totalAttempts, msg.attempts),
          elapsed: msg.elapsed,
          workers: numWorkers,
        }));
        killAll();
        process.exit(0);
      }

      if (msg.type === 'progress') {
        workerAttempts[i] = msg.attempts;
        const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);

        if (totalAttempts > MAX_ATTEMPTS) {
          process.stderr.write(JSON.stringify({
            error: 'Max attempts reached',
            attempts: totalAttempts,
            elapsed: msg.elapsed,
            maxAttempts: MAX_ATTEMPTS,
            workers: numWorkers,
          }) + '\n');
          killAll();
          process.exit(1);
        }

        process.stderr.write(JSON.stringify({
          attempts: totalAttempts,
          elapsed: msg.elapsed,
          workers: numWorkers,
        }) + '\n');
      }
    });

    worker.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      killAll();
      console.error(JSON.stringify({ error: `Worker error: ${err.message}` }));
      process.exit(1);
    });

    worker.on('exit', (code) => {
      exited++;
      if (!resolved && exited === numWorkers) {
        console.error(JSON.stringify({ error: 'All workers exited without finding a match' }));
        process.exit(1);
      }
    });

    workers.push(worker);
  }
}
