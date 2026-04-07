import { statSync } from 'fs';
import { execSync } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';
import type { PreflightResult } from '@/types.js';
import { ORIGINAL_SALT, ISSUE_URL, diagnostics } from '@/constants.js';
import {
  findClaudeBinary,
  findBunBinary,
  findAllClaudeBinaries,
  MIN_SUPPORTED_VERSION,
} from './binary-finder.ts';
import { restoreBinary } from './patch.ts';
import { verifySalt, isNodeRuntime, getMinSaltCount } from './salt-ops.ts';
import { getClaudeUserId, loadPetConfig } from '@/config/index.js';

export async function runPreflight({
  requireBinary = true,
  silent = false,
} = {}): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check bun is installed (deferred — may not be needed for Node-based installs)
  let bunVersion: string | null = null;
  let bunMissing = false;
  try {
    const bunPath = findBunBinary();
    bunVersion = execSync(`"${bunPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    bunMissing = true;
  }

  // 2. Check Claude config exists and has a userId
  const userId = getClaudeUserId();
  if (userId === 'anon') {
    warnings.push(
      'No user ID found in ~/.claude.json (using "anon").\n' +
        "  This usually means Claude Code hasn't been set up yet.\n" +
        '  The generated pet may not match what Claude Code shows.',
    );
  }

  // 3. Find and validate the binary
  let binaryPath: string | null = null;
  let saltCount = 0;

  if (requireBinary) {
    // Check for multiple installations and prompt user to select
    if (!process.env.CLAUDE_BINARY && !silent) {
      const allBinaries = findAllClaudeBinaries();
      if (allBinaries.length > 1) {
        const supported = allBinaries.filter((b) => b.supported);
        const unsupported = allBinaries.filter((b) => !b.supported);

        console.log(chalk.yellow(`\n  Found ${allBinaries.length} Claude Code installation(s):\n`));

        for (const b of allBinaries) {
          const ver = b.version ? `v${b.version}` : 'unknown version';
          const src = b.source.charAt(0).toUpperCase() + b.source.slice(1);
          if (b.supported) {
            console.log(chalk.green(`    ${src} ${ver}  ${chalk.dim(b.path)}`));
          } else {
            console.log(
              chalk.red(
                `    ${src} ${ver}  ${chalk.dim(b.path)}  (requires v${MIN_SUPPORTED_VERSION}+)`,
              ),
            );
          }
        }
        console.log();

        if (supported.length === 0) {
          errors.push(
            `All ${allBinaries.length} Claude Code installations are too old.\n` +
              `  any-buddy requires Claude Code v${MIN_SUPPORTED_VERSION} or newer.\n` +
              '  Please update Claude Code and try again.',
          );
        } else if (supported.length === 1) {
          binaryPath = supported[0].path;
          if (unsupported.length > 0) {
            console.log(
              chalk.dim(
                `  Auto-selected the only supported installation (${supported[0].source} v${supported[0].version}).`,
              ),
            );
            console.log(chalk.dim(`  Tip: Remove old installations to avoid confusion.\n`));
          }
        } else {
          try {
            const { selectClaudeBinary } = await import('@/tui/prompts.js');
            binaryPath = await selectClaudeBinary(allBinaries);
          } catch {
            // Prompt failed (non-interactive) — fall back to auto-selection
            binaryPath = findClaudeBinary();
          }
        }
      }
    }

    if (!binaryPath) {
      try {
        binaryPath = findClaudeBinary();
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    if (binaryPath) {
      try {
        const size = statSync(binaryPath).size;
        if (size < 1_000_000) {
          warnings.push(
            `Binary at ${binaryPath} is only ${(size / 1024).toFixed(0)}KB.\n` +
              '  This might be a shell script, symlink wrapper, or npm shim rather than the actual binary.\n' +
              '  If patching fails, try setting CLAUDE_BINARY to the real compiled binary.',
          );
        }
      } catch {
        /* ignore */
      }

      try {
        const origResult = verifySalt(binaryPath, ORIGINAL_SALT);
        saltCount = origResult.found;

        if (saltCount === 0) {
          const petConfig = loadPetConfig();
          if (petConfig?.salt) {
            const patchedResult = verifySalt(binaryPath, petConfig.salt);
            const minCount = getMinSaltCount(binaryPath);
            if (patchedResult.found >= minCount) {
              saltCount = patchedResult.found;
              warnings.push(
                'Binary is already patched with a custom salt from a previous run.\n' +
                  '  Re-patching will replace it with your new selection.',
              );
            } else {
              // Try to auto-restore from backup
              console.log(
                chalk.yellow('  Salt mismatch detected — attempting to restore from backup...'),
              );
              try {
                restoreBinary(binaryPath);
                const recheck = verifySalt(binaryPath, ORIGINAL_SALT);
                if (recheck.found > 0) {
                  saltCount = recheck.found;
                  console.log(chalk.green('  Restored successfully.\n'));
                } else {
                  errors.push(
                    `Restore succeeded but original salt still not found in ${binaryPath}.\n` +
                      '  The binary may have been updated with a new salt.\n\n' +
                      diagnostics({ Binary: binaryPath }) +
                      `\n  Please report this at: ${ISSUE_URL}`,
                  );
                }
              } catch {
                errors.push(
                  `Neither the original salt nor your saved salt were found in ${binaryPath}.\n` +
                    '  No backup available to restore from.\n' +
                    '  Try reinstalling Claude Code, then run any-buddy again.\n\n' +
                    diagnostics({ Binary: binaryPath }) +
                    `\n  Please report this at: ${ISSUE_URL}`,
                );
              }
            }
          } else {
            errors.push(
              `Salt "${ORIGINAL_SALT}" not found in ${binaryPath}.\n` +
                '  Possible reasons:\n' +
                '  - Binary was patched by another tool\n' +
                "  - This binary format doesn't contain the salt as a plain string\n" +
                '  - Claude Code changed the salt in a new version\n\n' +
                diagnostics({ Binary: binaryPath }) +
                `\n  Please report this at: ${ISSUE_URL}`,
            );
          }
        } else if (saltCount < getMinSaltCount(binaryPath)) {
          const expectedCount = getMinSaltCount(binaryPath);
          warnings.push(
            `Salt found only ${saltCount} time(s) in binary (expected ${expectedCount}).\n` +
              '  This might work but the patch may be incomplete.\n' +
              diagnostics(),
          );
        }
      } catch (err) {
        errors.push(
          `Could not read binary at ${binaryPath}: ${(err as Error).message}\n` +
            '  Check file permissions.',
        );
      }

      const plat = platform();
      if (plat === 'win32') {
        warnings.push(
          'Windows support is experimental.\n' +
            '  You must close all Claude Code windows before patching.\n' +
            '  If you encounter issues, please report them at: ' +
            ISSUE_URL,
        );
      } else if (plat === 'darwin') {
        warnings.push(
          'macOS: the binary will be ad-hoc re-signed after patching.\n' +
            "  If Claude Code won't launch, run `any-buddy restore`.\n" +
            '  Please report issues at: ' +
            ISSUE_URL,
        );
      }
    }
  }

  // Bun requirement check
  const nodeRuntime = binaryPath ? isNodeRuntime(binaryPath) : false;
  if (bunMissing && !nodeRuntime) {
    errors.push(
      'Bun is not installed or not on PATH.\n' +
        '  any-buddy needs Bun to compute the correct hash (Claude Code uses Bun.hash/wyhash).\n' +
        '  Install Bun: https://bun.sh',
    );
  }

  for (const w of warnings) {
    console.log(chalk.yellow(`  Warning: ${w}\n`));
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.log(chalk.red(`  Error: ${e}\n`));
    }
    return { ok: false, binaryPath, userId, saltCount, bunVersion };
  }

  return { ok: true, binaryPath, userId, saltCount, bunVersion };
}
