import { readFileSync, existsSync, statSync, realpathSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { ISSUE_URL, diagnostics } from '@/constants.js';

const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';

export const MIN_SUPPORTED_VERSION = '2.1.89';

export interface ClaudeBinaryInfo {
  path: string;
  version: string | null;
  source: 'brew' | 'npm' | 'local' | 'volta' | 'system' | 'unknown';
  supported: boolean;
}

function which(cmd: string): string | null {
  try {
    const shellCmd = IS_WIN ? `where ${cmd}` : `which -a ${cmd}`;
    const result = execSync(shellCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const first = result.split(/\r?\n/)[0].trim();
    if (first && existsSync(first)) return first;
  } catch {
    /* ignore */
  }
  return null;
}

function whichAll(cmd: string): string[] {
  try {
    const shellCmd = IS_WIN ? `where ${cmd}` : `which -a ${cmd}`;
    const result = execSync(shellCmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && existsSync(l));
  } catch {
    /* ignore */
  }
  return [];
}

function isNpmManagedPath(resolvedPath: string): boolean {
  const lower = resolvedPath.toLowerCase();
  return (
    lower.includes('node_modules') ||
    lower.includes('.npm-global') ||
    lower.includes('.nvm/') ||
    lower.includes('/fnm/')
  );
}

function realpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function getPlatformCandidates(): string[] {
  const home = homedir();

  if (IS_WIN) {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [
      join(localAppData, 'Programs', 'claude', 'claude.exe'),
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      join(home, '.volta', 'bin', 'claude.exe'),
    ];
  }

  if (IS_MAC) {
    return [
      join(home, '.local', 'bin', 'claude'),
      join(home, '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(home, '.npm-global', 'bin', 'claude'),
      join(home, '.volta', 'bin', 'claude'),
    ];
  }

  return [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    join(home, '.npm-global', 'bin', 'claude'),
    join(home, '.volta', 'bin', 'claude'),
  ];
}

function resolveWindowsShim(cmdPath: string): string | null {
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    const match = content.match(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/][^\s"]+/);
    if (match) {
      const shimDir = dirname(cmdPath);
      const target = join(shimDir, match[0]);
      if (existsSync(target)) return target;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveFromPackageDir(resolvedPath: string): string | null {
  try {
    const ccPkg = join('@anthropic-ai', 'claude-code');
    const idx = resolvedPath.indexOf(ccPkg);
    if (idx === -1) return null;

    const pkgDir = resolvedPath.substring(0, idx + ccPkg.length);
    const binaryName = IS_WIN ? 'claude.exe' : 'claude';
    const candidate = join(pkgDir, binaryName);
    if (existsSync(candidate)) {
      const size = statSync(candidate).size;
      if (size >= 1_000_000) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getClaudeVersion(binaryPath: string): string | null {
  try {
    const output = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Output is like "2.1.92 (Claude Code)" — extract the version number
    const match = output.match(/^([\d.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function classifySource(resolvedPath: string): ClaudeBinaryInfo['source'] {
  const lower = resolvedPath.toLowerCase();
  if (lower.includes('/homebrew/') || lower.includes('/brew/')) return 'brew';
  if (isNpmManagedPath(resolvedPath)) return 'npm';
  if (lower.includes('.volta')) return 'volta';
  if (lower.includes('.local/bin') || lower.includes('.claude/local')) return 'local';
  if (lower.includes('/usr/local/bin') || lower.includes('/usr/bin')) return 'system';
  return 'unknown';
}

function resolveOneBinary(onPath: string): string | null {
  const resolved = realpath(onPath);

  if (IS_WIN && resolved.endsWith('.cmd')) {
    const target = resolveWindowsShim(resolved);
    if (target) return target;
  }

  try {
    const size = statSync(resolved).size;
    if (size >= 1_000_000) return resolved;

    const fromPkg = resolveFromPackageDir(resolved);
    if (fromPkg) return fromPkg;

    if (IS_WIN && !resolved.endsWith('.cmd')) {
      const target = resolveWindowsShim(resolved + '.cmd');
      if (target) return target;
    }
  } catch {
    return resolved;
  }

  return null;
}

export function findAllClaudeBinaries(): ClaudeBinaryInfo[] {
  const seen = new Set<string>();
  const results: ClaudeBinaryInfo[] = [];

  function addCandidate(path: string) {
    const resolved = realpath(path);
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const version = getClaudeVersion(resolved);
    const source = classifySource(resolved);
    const supported = version ? compareVersions(version, MIN_SUPPORTED_VERSION) >= 0 : false;
    results.push({ path: resolved, version, source, supported });
  }

  // From PATH
  const allOnPath = whichAll('claude');
  for (const onPath of allOnPath) {
    const resolved = resolveOneBinary(onPath);
    // Fall back to the raw path if resolveOneBinary couldn't find a large binary
    addCandidate(resolved ?? realpath(onPath));
  }

  // From platform candidates
  const candidates = getPlatformCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      addCandidate(candidate);
    }
  }

  return results;
}

export function findClaudeBinary(): string {
  if (process.env.CLAUDE_BINARY) {
    const p = process.env.CLAUDE_BINARY;
    if (existsSync(p)) return realpath(p);
    throw new Error(`CLAUDE_BINARY="${p}" does not exist.`);
  }

  const allOnPath = whichAll('claude');
  let npmFallback: string | null = null;

  for (const onPath of allOnPath) {
    const resolved = realpath(onPath);

    if (IS_WIN && resolved.endsWith('.cmd')) {
      const target = resolveWindowsShim(resolved);
      if (target) {
        if (isNpmManagedPath(target)) {
          npmFallback = npmFallback ?? target;
          continue;
        }
        return target;
      }
    }

    try {
      const size = statSync(resolved).size;
      if (size >= 1_000_000) {
        if (isNpmManagedPath(resolved)) {
          npmFallback = npmFallback ?? resolved;
          continue;
        }
        return resolved;
      }
      const fromPkg = resolveFromPackageDir(resolved);
      if (fromPkg) {
        if (isNpmManagedPath(fromPkg)) {
          npmFallback = npmFallback ?? fromPkg;
          continue;
        }
        return fromPkg;
      }

      if (IS_WIN && !resolved.endsWith('.cmd')) {
        const target = resolveWindowsShim(resolved + '.cmd');
        if (target) {
          if (isNpmManagedPath(target)) {
            npmFallback = npmFallback ?? target;
            continue;
          }
          return target;
        }
      }
    } catch {
      if (!isNpmManagedPath(resolved)) return resolved;
      npmFallback = npmFallback ?? resolved;
    }
  }

  if (npmFallback) {
    // Check platform candidates first — prefer native installs (e.g. Brew) over npm
    const candidates = getPlatformCandidates();
    for (const candidate of candidates) {
      if (existsSync(candidate) && !isNpmManagedPath(candidate)) {
        return realpath(candidate);
      }
    }
    return npmFallback;
  }

  const candidates = getPlatformCandidates();

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return realpath(candidate);
    }
  }

  const platformHint = IS_WIN
    ? 'On Windows, Claude Code is typically installed via npm or the desktop app.'
    : IS_MAC
      ? 'On macOS, Claude Code is typically at ~/.claude/local/ or installed via npm/brew.'
      : 'On Linux, Claude Code is typically at ~/.local/share/claude/versions/.';

  const tried = candidates.map((c) => `    - ${c}`).join('\n');
  throw new Error(
    'Could not find Claude Code binary.\n' +
      diagnostics({
        Tried: '`' + (IS_WIN ? 'where' : 'which') + ' claude` and these paths:',
      }) +
      '\n' +
      tried +
      '\n\n  ' +
      platformHint +
      '\n  Set CLAUDE_BINARY=/path/to/binary to specify manually.' +
      `\n\n  If this is a bug, please report it at:\n  ${ISSUE_URL}`,
  );
}

export function findBunBinary(): string {
  const onPath = which('bun');
  if (onPath) return onPath;

  const home = homedir();
  const candidates = IS_WIN
    ? [join(home, '.bun', 'bin', 'bun.exe'), join(home, '.volta', 'bin', 'bun.exe')]
    : [join(home, '.bun', 'bin', 'bun'), '/usr/local/bin/bun', join(home, '.volta', 'bin', 'bun')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return realpath(candidate);
  }

  return 'bun';
}
