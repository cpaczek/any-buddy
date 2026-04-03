import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { basename } from 'path';
import { platform } from 'os';
import type { SaltState } from '@/types.js';
import { ORIGINAL_SALT } from '@/constants.js';

const IS_WIN = platform() === 'win32';

export function findAllOccurrences(buffer: Buffer, searchStr: string): number[] {
  const searchBuf = Buffer.from(searchStr, 'utf-8');
  const offsets: number[] = [];
  let pos = 0;
  while (pos < buffer.length) {
    const idx = buffer.indexOf(searchBuf, pos);
    if (idx === -1) break;
    offsets.push(idx);
    pos = idx + 1;
  }
  return offsets;
}

export function getCurrentSalt(binaryPath: string): SaltState {
  const buf = readFileSync(binaryPath);
  const origOffsets = findAllOccurrences(buf, ORIGINAL_SALT);
  const minCount = getMinSaltCount(binaryPath);
  if (origOffsets.length >= minCount) {
    return { salt: ORIGINAL_SALT, patched: false, offsets: origOffsets };
  }
  return { salt: null, patched: true, offsets: origOffsets };
}

export function verifySalt(binaryPath: string, salt: string): { found: number; offsets: number[] } {
  const buf = readFileSync(binaryPath);
  const offsets = findAllOccurrences(buf, salt);
  return { found: offsets.length, offsets };
}

export function isClaudeRunning(binaryPath: string): boolean {
  try {
    if (IS_WIN) {
      const out = execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH 2>nul', {
        encoding: 'utf-8',
      });
      return out.includes('claude.exe');
    }
    const name = basename(binaryPath);
    const out = execSync(`pgrep -x "${name}" 2>/dev/null || true`, { encoding: 'utf-8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export function isNodeRuntime(binaryPath: string): boolean {
  return binaryPath.endsWith('.js') || binaryPath.endsWith('.mjs');
}

export function getMinSaltCount(binaryPath: string): number {
  return isNodeRuntime(binaryPath) ? 1 : 3;
}
