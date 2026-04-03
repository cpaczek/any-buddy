import { readFileSync, existsSync, statSync, realpathSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { ISSUE_URL, diagnostics } from '@/constants.js';

const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';

function which(cmd: string): string | null {
  try {
    const shellCmd = IS_WIN ? `where ${cmd}` : `which ${cmd}`;
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
    '/opt/claude-code/bin/claude',
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

export function resolveShellWrapper(scriptPath: string): string | null {
  if (IS_WIN) return null;
  try {
    const content = readFileSync(scriptPath, 'utf-8');
    if (!content.startsWith('#!')) return null;

    const match = content.match(/^\s*exec\s+(\/\S+)/m);
    if (!match) return null;

    const target = match[1];
    if (!existsSync(target)) return null;

    const size = statSync(target).size;
    if (size < 1_000_000) return null;

    return target;
  } catch {
    return null;
  }
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

export function findClaudeBinary(): string {
  if (process.env.CLAUDE_BINARY) {
    const p = process.env.CLAUDE_BINARY;
    if (existsSync(p)) return realpath(p);
    throw new Error(`CLAUDE_BINARY="${p}" does not exist.`);
  }

  const onPath = which('claude');
  if (onPath) {
    const resolved = realpath(onPath);

    if (IS_WIN && resolved.endsWith('.cmd')) {
      const target = resolveWindowsShim(resolved);
      if (target) return target;
    }

    try {
      const size = statSync(resolved).size;
      if (size >= 1_000_000) {
        return resolved;
      }
      const fromWrapper = resolveShellWrapper(resolved);
      if (fromWrapper) return fromWrapper;

      const fromPkg = resolveFromPackageDir(resolved);
      if (fromPkg) return fromPkg;

      if (IS_WIN && !resolved.endsWith('.cmd')) {
        const target = resolveWindowsShim(resolved + '.cmd');
        if (target) return target;
      }
    } catch {
      return resolved;
    }
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
  if (process.env.ANYBUDDY_BUN_PATH && existsSync(process.env.ANYBUDDY_BUN_PATH)) {
    return process.env.ANYBUDDY_BUN_PATH;
  }

  const onPath = which('bun');
  if (onPath) return onPath;

  const home = homedir();
  const candidates = IS_WIN
    ? [join(home, '.bun', 'bin', 'bun.exe'), join(home, '.volta', 'bin', 'bun.exe')]
    : [join(home, '.bun', 'bin', 'bun'), '/usr/local/bin/bun', join(home, '.volta', 'bin', 'bun')];

  // Under sudo, homedir() returns /root — also check the original user's home.
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && !IS_WIN) {
    const sudoHome = IS_MAC ? join('/Users', sudoUser) : join('/home', sudoUser);
    candidates.push(join(sudoHome, '.bun', 'bin', 'bun'), join(sudoHome, '.volta', 'bin', 'bun'));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return realpath(candidate);
  }

  return 'bun';
}
