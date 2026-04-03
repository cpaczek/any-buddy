import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveShellWrapper } from '@/patcher/binary-finder.js';

const tempDir = mkdtempSync(join(tmpdir(), 'anybuddy-binary-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createFakeBinary(name: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, Buffer.alloc(1_100_000, 0x41));
  return path;
}

function createScript(name: string, content: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('resolveShellWrapper', () => {
  it('resolves exec /path/to/binary "$@" pattern', () => {
    const binary = createFakeBinary('claude-real');
    const script = createScript('claude-wrapper-1', `#!/bin/sh\nexec ${binary} "$@"\n`);
    expect(resolveShellWrapper(script)).toBe(binary);
  });

  it('resolves exec /path/to/binary without args', () => {
    const binary = createFakeBinary('claude-no-args');
    const script = createScript('claude-wrapper-2', `#!/bin/sh\nexec ${binary}\n`);
    expect(resolveShellWrapper(script)).toBe(binary);
  });

  it('resolves with env exports before exec', () => {
    const binary = createFakeBinary('claude-env');
    const script = createScript(
      'claude-wrapper-3',
      `#!/bin/sh\nexport DISABLE_AUTOUPDATER=1\nexec ${binary} "$@"\n`,
    );
    expect(resolveShellWrapper(script)).toBe(binary);
  });

  it('returns null for files without shebang', () => {
    const binary = createFakeBinary('claude-noshebang');
    const script = createScript('no-shebang', `exec ${binary} "$@"\n`);
    expect(resolveShellWrapper(script)).toBeNull();
  });

  it('returns null when exec target does not exist', () => {
    const script = createScript(
      'claude-missing',
      '#!/bin/sh\nexec /nonexistent/path/to/claude "$@"\n',
    );
    expect(resolveShellWrapper(script)).toBeNull();
  });

  it('returns null when exec target is too small', () => {
    const tinyFile = join(tempDir, 'claude-tiny');
    writeFileSync(tinyFile, 'not a real binary');
    const script = createScript('claude-wrapper-tiny', `#!/bin/sh\nexec ${tinyFile} "$@"\n`);
    expect(resolveShellWrapper(script)).toBeNull();
  });

  it('returns null for scripts without exec', () => {
    const script = createScript('claude-no-exec', '#!/bin/sh\necho "hello"\n');
    expect(resolveShellWrapper(script)).toBeNull();
  });
});
