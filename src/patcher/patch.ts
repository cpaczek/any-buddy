import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  chmodSync,
  unlinkSync,
  renameSync,
  existsSync,
  accessSync,
  constants,
} from 'fs';
import { execSync } from 'child_process';
import { dirname } from 'path';
import { platform } from 'os';
import type { PatchResult } from '@/types.js';
import { ORIGINAL_SALT } from '@/constants.js';
import { findAllOccurrences } from './salt-ops.ts';

const IS_WIN = platform() === 'win32';
const IS_MAC = platform() === 'darwin';

function codesignBinary(binaryPath: string): { signed: boolean; error: string | null } {
  if (!IS_MAC) return { signed: false, error: null };
  try {
    execSync(`codesign --force --sign - "${binaryPath}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { signed: true, error: null };
  } catch (err) {
    return { signed: false, error: (err as Error).message };
  }
}

export function patchBinary(binaryPath: string, oldSalt: string, newSalt: string): PatchResult {
  if (oldSalt.length !== newSalt.length) {
    throw new Error(
      `Salt length mismatch: old=${oldSalt.length}, new=${newSalt.length}. Must be ${ORIGINAL_SALT.length} chars.`,
    );
  }

  try {
    accessSync(dirname(binaryPath), constants.W_OK);
  } catch {
    throw new Error(
      `No write permission on ${dirname(binaryPath)}.\n` +
        '  The binary is owned by root. Run with: sudo any-buddy',
    );
  }

  const buf = readFileSync(binaryPath);
  const offsets = findAllOccurrences(buf, oldSalt);

  if (offsets.length === 0) {
    throw new Error(
      `Could not find salt "${oldSalt}" in binary at ${binaryPath}.\n` +
        '  The binary may already be patched with a different salt, or Claude Code has changed.\n\n' +
        '  If you think this is a bug, please report it at:\n' +
        '  https://github.com/cpaczek/any-buddy/issues',
    );
  }

  const backupPath = binaryPath + '.anybuddy-bak';
  if (!existsSync(backupPath)) {
    copyFileSync(binaryPath, backupPath);
  }

  const newBuf = Buffer.from(newSalt, 'utf-8');
  for (const offset of offsets) {
    newBuf.copy(buf, offset);
  }

  const stats = statSync(binaryPath);
  const tmpPath = binaryPath + '.anybuddy-tmp';

  try {
    writeFileSync(tmpPath, buf);
    if (!IS_WIN) chmodSync(tmpPath, stats.mode);

    try {
      renameSync(tmpPath, binaryPath);
    } catch {
      try {
        unlinkSync(binaryPath);
      } catch {
        /* ignore */
      }
      renameSync(tmpPath, binaryPath);
    }
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }

    if (IS_WIN && (err as NodeJS.ErrnoException).code === 'EPERM') {
      throw new Error(
        'Cannot patch: the binary is locked (Claude Code may be running).\n' +
          '  Close all Claude Code windows and try again.',
      );
    }
    throw err;
  }

  const verifyBuf = readFileSync(binaryPath);
  const verify = findAllOccurrences(verifyBuf, newSalt);
  const cs = codesignBinary(binaryPath);

  return {
    replacements: offsets.length,
    verified: verify.length === offsets.length,
    backupPath,
    codesigned: cs.signed,
    codesignError: cs.error,
  };
}

export function restoreBinary(binaryPath: string): true {
  const backupPath = binaryPath + '.anybuddy-bak';
  if (!existsSync(backupPath)) {
    throw new Error('No backup found. Cannot restore.\n' + `  Expected: ${backupPath}`);
  }

  const stats = statSync(backupPath);
  const tmpPath = binaryPath + '.anybuddy-tmp';

  try {
    copyFileSync(backupPath, tmpPath);
    if (!IS_WIN) chmodSync(tmpPath, stats.mode);

    try {
      renameSync(tmpPath, binaryPath);
    } catch {
      try {
        unlinkSync(binaryPath);
      } catch {
        /* ignore */
      }
      renameSync(tmpPath, binaryPath);
    }
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    if (IS_WIN && (err as NodeJS.ErrnoException).code === 'EPERM') {
      throw new Error(
        'Cannot restore: the binary is locked (Claude Code may be running).\n' +
          '  Close all Claude Code windows and try again.',
      );
    }
    throw err;
  }

  return true;
}
