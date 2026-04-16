import chalk from 'chalk';
import { ORIGINAL_SALT } from '@/constants.js';
import { roll } from '@/generation/index.js';
import { findClaudeBinary } from '@/patcher/binary-finder.js';
import { isNodeRuntime } from '@/patcher/salt-ops.js';
import { runPreflight } from '@/patcher/preflight.js';
import { loadPetConfig } from '@/config/index.js';
import { banner, showPet } from '../display.ts';

export async function runCurrent(): Promise<void> {
  banner();
  const preflight = await runPreflight({ requireBinary: false });
  if (!preflight.ok) process.exit(1);
  const userId = preflight.userId;
  console.log(chalk.dim(`  User ID: ${userId.slice(0, 12)}...`));

  let useNodeHash = false;
  try {
    const bp = findClaudeBinary();
    useNodeHash = isNodeRuntime(bp);
  } catch {
    /* ignore — binary not required for current */
  }
  if (useNodeHash) {
    console.log(chalk.dim('  Runtime: Node (FNV-1a hash)'));
  }

  const origResult = roll(userId, ORIGINAL_SALT, { useNodeHash });
  showPet(origResult.bones, 'Default pet (original salt)');

  const config = loadPetConfig();
  if (config?.salt && config.salt !== ORIGINAL_SALT) {
    const patchedResult = roll(userId, config.salt, { useNodeHash });
    showPet(patchedResult.bones, 'Active pet (patched)');
  }
}
