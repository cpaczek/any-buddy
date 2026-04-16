#!/usr/bin/env node
// Patches the Claude Code binary to replace the salt string.
// Handles binary discovery, backup, atomic write, and macOS code signing.
//
// Usage: node patch-binary.mjs <newSalt> [--restore] [--check] [--apply] [--install-hook] [--remove-hook]
// --restore:      Restore from backup
// --check:        Just show current salt status (no changes)
// --apply:        Re-apply saved salt if binary reverted (for use in hooks)
// --install-hook: Add SessionStart hook to ~/.claude/settings.json
// --remove-hook:  Remove SessionStart hook from ~/.claude/settings.json
//
// No external dependencies required.

import { readFileSync, writeFileSync, copyFileSync, statSync, chmodSync, realpathSync, unlinkSync, renameSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname, basename } from 'path';
import { homedir, platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';
const ORIGINAL_SALT = 'friend-2026-401';
// Windows binaries have fewer salt occurrences than macOS/Linux
const MIN_SALT_COUNT = IS_WIN ? 1 : 3;

// --- Binary discovery ---

function which(cmd) {
  try {
    const bin = IS_WIN ? 'where' : 'which';
    const result = execFileSync(bin, [cmd], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const first = result.split(/\r?\n/)[0].trim();
    if (first && existsSync(first)) return first;
  } catch { /* ignore */ }
  return null;
}

function realpath(p) {
  try { return realpathSync(p); } catch { return p; }
}

function resolveFromPackageDir(resolvedPath) {
  try {
    const ccPkg = join('@anthropic-ai', 'claude-code');
    const idx = resolvedPath.indexOf(ccPkg);
    if (idx === -1) return null;
    const pkgDir = resolvedPath.substring(0, idx + ccPkg.length);
    const binaryName = IS_WIN ? 'claude.exe' : 'claude';
    const candidate = join(pkgDir, binaryName);
    if (existsSync(candidate) && statSync(candidate).size >= 1_000_000) return candidate;
  } catch { /* ignore */ }
  return null;
}

function resolveWindowsShim(cmdPath) {
  try {
    const content = readFileSync(cmdPath, 'utf-8');
    // npm .cmd shims contain a line like: "%~dp0\node_modules\@anthropic-ai\claude-code\cli.mjs"
    const match = content.match(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/][^\s"]+/);
    if (match) {
      const shimDir = dirname(cmdPath);
      const target = join(shimDir, match[0]);
      if (existsSync(target)) return target;
    }
  } catch { /* ignore */ }
  return null;
}

function findClaudeBinary() {
  if (process.env.CLAUDE_BINARY) {
    const p = process.env.CLAUDE_BINARY;
    if (existsSync(p)) return realpath(p);
    throw new Error(`CLAUDE_BINARY="${p}" does not exist.`);
  }

  const onPath = which('claude');
  if (onPath) {
    // On Windows, npm installs .cmd shims — resolve through them
    if (IS_WIN && onPath.endsWith('.cmd')) {
      const shimTarget = resolveWindowsShim(onPath);
      if (shimTarget) {
        const fromPkg = resolveFromPackageDir(shimTarget);
        if (fromPkg) return fromPkg;
      }
    }

    const resolved = realpath(onPath);
    try {
      if (statSync(resolved).size >= 1_000_000) return resolved;
      // Small file — likely a Volta/nvm/npm shim. Try to find real binary nearby.
      const fromPkg = resolveFromPackageDir(resolved);
      if (fromPkg) return fromPkg;

      if (IS_WIN && !resolved.endsWith('.cmd')) {
        const target = resolveWindowsShim(resolved + '.cmd');
        if (target) return target;
      }
    } catch { return resolved; }
  }

  const home = homedir();
  const candidates = IS_MAC
    ? [
        join(home, '.local', 'bin', 'claude'),
        join(home, '.claude', 'local', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        join(home, '.npm-global', 'bin', 'claude'),
        join(home, '.volta', 'bin', 'claude'),
      ]
    : IS_WIN
      ? [
          join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'claude', 'claude.exe'),
          join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
          join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
          join(home, '.volta', 'bin', 'claude.exe'),
        ]
      : [
          join(home, '.local', 'bin', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
          join(home, '.npm-global', 'bin', 'claude'),
          join(home, '.volta', 'bin', 'claude'),
        ];

  for (const c of candidates) {
    if (!existsSync(c)) continue;
    // For .cmd files on Windows, resolve through the shim
    if (IS_WIN && c.endsWith('.cmd')) {
      const shimTarget = resolveWindowsShim(c);
      if (shimTarget) {
        const fromPkg = resolveFromPackageDir(shimTarget);
        if (fromPkg) return fromPkg;
      }
    }
    const resolved = realpath(c);
    try {
      if (statSync(resolved).size >= 1_000_000) return resolved;
      const fromPkg = resolveFromPackageDir(resolved);
      if (fromPkg) return fromPkg;
    } catch { /* fall through to next candidate */ }
  }

  throw new Error('Could not find Claude Code binary. Set CLAUDE_BINARY=/path/to/binary.');
}

// Detect whether the Claude binary runs under Node (not Bun).
// On Windows npm installs, the binary is a .js file executed by Node, which uses FNV-1a
// instead of Bun.hash (wyhash). This changes the hash function used for companion generation.
function isNodeRuntime(binaryPath) {
  return binaryPath.endsWith('.js') || binaryPath.endsWith('.mjs');
}

// --- Process detection ---

function isClaudeRunning(binaryPath) {
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/NH'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return out.includes('claude.exe');
    }
    const name = basename(binaryPath);
    const out = execFileSync('pgrep', ['-f', name], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// --- Binary operations ---

function findAllOccurrences(buffer, searchStr) {
  const searchBuf = Buffer.from(searchStr, 'utf-8');
  const offsets = [];
  let pos = 0;
  while (pos < buffer.length) {
    const idx = buffer.indexOf(searchBuf, pos);
    if (idx === -1) break;
    offsets.push(idx);
    pos = idx + 1;
  }
  return offsets;
}

function findCurrentSalt(binaryPath) {
  const buf = readFileSync(binaryPath);

  // Check original salt first
  const origOffsets = findAllOccurrences(buf, ORIGINAL_SALT);
  if (origOffsets.length >= MIN_SALT_COUNT) {
    return { salt: ORIGINAL_SALT, patched: false, offsets: origOffsets };
  }

  // Check saved config for previously patched salt
  const configPath = join(homedir(), '.claude-code-any-buddy.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.salt) {
        const patchedOffsets = findAllOccurrences(buf, config.salt);
        if (patchedOffsets.length >= MIN_SALT_COUNT) {
          return { salt: config.salt, patched: true, offsets: patchedOffsets };
        }
      }
    } catch { /* ignore */ }
  }

  return { salt: null, patched: false, offsets: [] };
}

function patchBinary(binaryPath, oldSalt, newSalt) {
  if (oldSalt.length !== newSalt.length) {
    throw new Error(`Salt length mismatch: old=${oldSalt.length}, new=${newSalt.length}. Must be ${ORIGINAL_SALT.length} chars.`);
  }

  const buf = readFileSync(binaryPath);
  const offsets = findAllOccurrences(buf, oldSalt);

  if (offsets.length === 0) {
    throw new Error(`Could not find salt "${oldSalt}" in binary. It may already be patched differently.`);
  }

  // Create backup
  const backupPath = binaryPath + '.anybuddy-bak';
  if (!existsSync(backupPath)) {
    copyFileSync(binaryPath, backupPath);
  }

  // Replace all occurrences
  const newBuf = Buffer.from(newSalt, 'utf-8');
  for (const offset of offsets) {
    newBuf.copy(buf, offset);
  }

  // Atomic write
  const stats = statSync(binaryPath);
  const tmpPath = binaryPath + '.anybuddy-tmp';

  try {
    writeFileSync(tmpPath, buf);
    if (!IS_WIN) chmodSync(tmpPath, stats.mode);
    try {
      renameSync(tmpPath, binaryPath);
    } catch {
      try { unlinkSync(binaryPath); } catch { /* ignore */ }
      renameSync(tmpPath, binaryPath);
    }
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  // Verify
  const verifyBuf = readFileSync(binaryPath);
  const verified = findAllOccurrences(verifyBuf, newSalt).length === offsets.length;

  // Re-sign on macOS
  let codesigned = false;
  if (IS_MAC) {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', binaryPath], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
      codesigned = true;
    } catch { /* ignore */ }
  }

  return { replacements: offsets.length, verified, backupPath, codesigned };
}

function restoreBinary(binaryPath) {
  const backupPath = binaryPath + '.anybuddy-bak';
  if (!existsSync(backupPath)) {
    throw new Error(`No backup found at ${backupPath}`);
  }

  const stats = statSync(backupPath);
  const tmpPath = binaryPath + '.anybuddy-tmp';

  copyFileSync(backupPath, tmpPath);
  if (!IS_WIN) chmodSync(tmpPath, stats.mode);
  try {
    renameSync(tmpPath, binaryPath);
  } catch {
    try { unlinkSync(binaryPath); } catch { /* ignore */ }
    renameSync(tmpPath, binaryPath);
  }

  // Re-sign on macOS
  if (IS_MAC) {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', binaryPath], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    } catch { /* ignore */ }
  }

  return true;
}

// --- Config helpers ---

function saveConfig(salt, traits) {
  const configPath = join(homedir(), '.claude-code-any-buddy.json');
  let existing = {};
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* ignore */ }
  }
  const data = { ...existing, salt, ...traits, patchedAt: new Date().toISOString() };
  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
}

// --- Hook management ---
// The hook command uses the absolute path to this script so it works regardless of cwd.

const HOOK_COMMAND = `node "${join(__dirname, 'patch-binary.mjs')}" --apply`;

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

function getClaudeSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  const raw = readFileSync(SETTINGS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${SETTINGS_PATH} contains invalid JSON and cannot be safely modified.\n` +
      `Please fix or remove the file manually.\n` +
      `Parse error: ${err.message}`
    );
  }
}

function saveClaudeSettings(settings) {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = SETTINGS_PATH + '.anybuddy-tmp';
  const data = JSON.stringify(settings, null, 2) + '\n';
  try {
    writeFileSync(tmpPath, data);
    renameSync(tmpPath, SETTINGS_PATH);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

function isHookInstalled() {
  const settings = getClaudeSettings();
  const matchers = settings.hooks?.SessionStart;
  if (!Array.isArray(matchers)) return false;
  return matchers.some(m =>
    Array.isArray(m.hooks) && m.hooks.some(h => h.command && h.command.includes('patch-binary.mjs') && h.command.includes('--apply'))
  );
}

function installHook() {
  const settings = getClaudeSettings();
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

  // Remove any existing any-buddy hooks (old or new format)
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    m => !Array.isArray(m.hooks) || !m.hooks.some(h =>
      h.command && (h.command.includes('patch-binary.mjs') || h.command.includes('any-buddy'))
    )
  );

  // Add fresh hook
  settings.hooks.SessionStart.push({
    matcher: '',
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  });

  saveClaudeSettings(settings);
  return true;
}

function removeHook() {
  const settings = getClaudeSettings();
  if (!settings.hooks?.SessionStart) return false;

  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    m => !Array.isArray(m.hooks) || !m.hooks.some(h =>
      h.command && (h.command.includes('patch-binary.mjs') || h.command.includes('any-buddy'))
    )
  );

  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  saveClaudeSettings(settings);
  return settings.hooks?.SessionStart?.length !== before;
}

// --- Apply mode (for hook use) ---
// Reads saved salt from config. If binary has reverted to original salt, re-patches silently.

function applySavedSalt(silent) {
  const configPath = join(homedir(), '.claude-code-any-buddy.json');
  if (!existsSync(configPath)) {
    if (!silent) console.error('No saved config found. Nothing to apply.');
    process.exit(silent ? 0 : 1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    if (!silent) console.error('Could not read saved config.');
    process.exit(silent ? 0 : 1);
  }

  if (!config.salt) {
    if (!silent) console.error('No saved salt in config.');
    process.exit(silent ? 0 : 1);
  }

  let binaryPath;
  try {
    binaryPath = findClaudeBinary();
  } catch (err) {
    if (!silent) console.error(err.message);
    process.exit(silent ? 0 : 1);
  }

  // Check if already patched with our salt
  const buf = readFileSync(binaryPath);
  const savedOffsets = findAllOccurrences(buf, config.salt);
  if (savedOffsets.length >= MIN_SALT_COUNT) {
    if (!silent) console.log(JSON.stringify({ status: 'already_patched', salt: config.salt, binaryPath }));
    process.exit(0);
  }

  // Check if binary has the original salt (meaning Claude was updated)
  let origOffsets = findAllOccurrences(buf, ORIGINAL_SALT);
  if (origOffsets.length < MIN_SALT_COUNT) {
    // Neither saved nor original salt found — try auto-restore from backup
    const backupPath = binaryPath + '.anybuddy-bak';
    if (existsSync(backupPath)) {
      try {
        restoreBinary(binaryPath);
        // Re-read and check for original salt after restore
        const restoredBuf = readFileSync(binaryPath);
        origOffsets = findAllOccurrences(restoredBuf, ORIGINAL_SALT);
        if (origOffsets.length < MIN_SALT_COUNT) {
          if (!silent) console.error('Restored from backup but original salt still not found.');
          process.exit(silent ? 0 : 1);
        }
      } catch (err) {
        if (!silent) console.error(`Auto-restore failed: ${err.message}`);
        process.exit(silent ? 0 : 1);
      }
    } else {
      if (!silent) console.error('Binary has neither original nor saved salt and no backup found. Manual intervention needed.');
      process.exit(silent ? 0 : 1);
    }
  }

  // Re-patch
  try {
    const result = patchBinary(binaryPath, ORIGINAL_SALT, config.salt);
    config.appliedAt = new Date().toISOString();
    config.appliedTo = binaryPath;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    if (!silent) {
      console.log(JSON.stringify({
        status: 're_patched',
        salt: config.salt,
        binaryPath,
        ...result,
      }));
    }
  } catch (err) {
    if (!silent) console.error(JSON.stringify({ error: err.message }));
    process.exit(silent ? 0 : 1);
  }
}

// --- Main ---

const args = process.argv.slice(2);
const isRestore = args.includes('--restore');
const isCheck = args.includes('--check');
const isApply = args.includes('--apply');
const isInstallHook = args.includes('--install-hook');
const isRemoveHook = args.includes('--remove-hook');
const isSilent = args.includes('--silent');
const newSalt = args.find(a => !a.startsWith('--'));

try {
  // Hook management (no binary access needed)
  if (isInstallHook) {
    installHook();
    console.log(JSON.stringify({ hookInstalled: true, command: HOOK_COMMAND }));
    process.exit(0);
  }

  if (isRemoveHook) {
    removeHook();
    console.log(JSON.stringify({ hookRemoved: true }));
    process.exit(0);
  }

  // Apply saved salt (for hook / re-patch after update)
  if (isApply) {
    applySavedSalt(isSilent);
    process.exit(0);
  }

  const binaryPath = findClaudeBinary();

  if (isCheck) {
    const current = findCurrentSalt(binaryPath);
    console.log(JSON.stringify({
      binaryPath,
      currentSalt: current.salt,
      isPatched: current.patched,
      occurrences: current.offsets.length,
      nodeRuntime: isNodeRuntime(binaryPath),
      hookInstalled: isHookInstalled(),
      claudeRunning: isClaudeRunning(binaryPath),
    }));
    process.exit(0);
  }

  if (isRestore) {
    restoreBinary(binaryPath);
    removeHook();
    const configPath = join(homedir(), '.claude-code-any-buddy.json');
    if (existsSync(configPath)) {
      try { unlinkSync(configPath); } catch { /* ignore */ }
    }
    console.log(JSON.stringify({ restored: true, binaryPath, hookRemoved: true }));
    process.exit(0);
  }

  if (!newSalt) {
    console.error('Usage: node patch-binary.mjs <newSalt> [--restore] [--check] [--apply] [--install-hook] [--remove-hook]');
    process.exit(1);
  }

  if (newSalt.length !== ORIGINAL_SALT.length) {
    console.error(`Salt must be exactly ${ORIGINAL_SALT.length} characters (got ${newSalt.length}).`);
    process.exit(1);
  }

  // Find what salt is currently in the binary
  const current = findCurrentSalt(binaryPath);
  if (!current.salt) {
    console.error('Could not find any known salt in the binary. It may have been patched by another tool.');
    process.exit(1);
  }

  const result = patchBinary(binaryPath, current.salt, newSalt);
  saveConfig(newSalt, {});

  // Auto-install hook after successful patch
  installHook();

  console.log(JSON.stringify({
    success: true,
    binaryPath,
    previousSalt: current.salt,
    newSalt,
    hookInstalled: true,
    claudeRunning: isClaudeRunning(binaryPath),
    ...result,
  }));
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
