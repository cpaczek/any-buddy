import chalk from 'chalk';

import { confirm, input, select } from '@inquirer/prompts';
import type { CliFlags, DesiredTraits } from '@/types.js';
import { SPECIES, EYES, RARITIES, HATS, STAT_NAMES, ORIGINAL_SALT } from '@/constants.js';
import { roll } from '@/generation/index.js';
import { findSalt, estimateAttempts } from '@/finder/index.js';
import {
  isNodeRuntime,
  verifySalt,
  getCurrentSalt,
  isClaudeRunning,
  getMinSaltCount,
} from '@/patcher/salt-ops.js';
import { patchBinary } from '@/patcher/patch.js';
import { runPreflight } from '@/patcher/preflight.js';
import { execWithSudo } from '@/patcher/sudo.js';
import {
  loadPetConfig,
  loadPetConfigV2,
  savePetConfigV2,
  saveProfile,
  isHookInstalled,
  installHook,
  getCompanionName,
  renameCompanion,
  getCompanionPersonality,
  setCompanionPersonality,
} from '@/config/index.js';
import { DEFAULT_PERSONALITIES } from '@/personalities.js';
import { banner, showPet, warnCodesign } from '../display.ts';
import { progressBar, formatCount } from '../format.ts';
import {
  validateFlag,
  selectSpecies,
  selectEyes,
  selectRarity,
  selectHat,
  selectStat,
} from '../prompts.ts';
import { PRESETS } from '@/presets.js';
import { allTraitsFlagged } from '../builder/state.ts';

function resolvePreset(
  presetName: string,
): Pick<DesiredTraits, 'species' | 'eye' | 'rarity' | 'hat'> {
  const match = PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
  if (!match) {
    const names = PRESETS.map((p) => `"${p.name}"`).join(', ');
    throw new Error(`Unknown preset "${presetName}". Available: ${names}`);
  }
  return { species: match.species, eye: match.eye, rarity: match.rarity, hat: match.hat };
}

async function selectCoreTraits(
  flags: CliFlags,
): Promise<Pick<DesiredTraits, 'species' | 'eye' | 'rarity' | 'hat'>> {
  // --preset flag: resolve by name
  if (flags.preset) {
    return resolvePreset(flags.preset);
  }

  // Manual selection
  const species = validateFlag('species', flags.species, SPECIES) ?? (await selectSpecies());
  const eye = validateFlag('eye', flags.eye, EYES) ?? (await selectEyes(species));
  const rarity = validateFlag('rarity', flags.rarity, RARITIES) ?? (await selectRarity());
  const hat =
    rarity === 'common'
      ? ('none' as const)
      : (validateFlag('hat', flags.hat, HATS) ?? (await selectHat(species, eye, rarity)));

  return { species, eye, rarity, hat };
}

async function runSequentialSelection(flags: CliFlags): Promise<DesiredTraits> {
  console.log(chalk.bold('  Choose your new pet:\n'));

  const { species, eye, rarity, hat } = await selectCoreTraits(flags);

  const shiny =
    flags.shiny ??
    (await confirm({
      message: 'Shiny? (1% normally — search takes ~100x longer)',
      default: false,
    }));
  const wantStats =
    flags.peak ||
    flags.dump ||
    (await confirm({
      message: 'Customize stats? (best/worst stat — search takes ~20x longer)',
      default: false,
    }));
  let peak: DesiredTraits['peak'] = null;
  let dump: DesiredTraits['dump'] = null;
  if (wantStats) {
    peak = validateFlag('peak', flags.peak, STAT_NAMES) ?? (await selectStat('Best stat'));
    dump =
      validateFlag('dump', flags.dump, STAT_NAMES) ??
      (await selectStat('Worst stat', peak ?? undefined));
  }

  return { species, eye, hat, rarity, shiny, peak, dump };
}

function buildDesiredFromFlags(flags: CliFlags): DesiredTraits {
  const species = validateFlag('species', flags.species, SPECIES);
  const eye = validateFlag('eye', flags.eye, EYES);
  const rarity = validateFlag('rarity', flags.rarity, RARITIES);
  const hat =
    rarity === 'common' ? ('none' as const) : (validateFlag('hat', flags.hat, HATS) ?? 'crown');

  return {
    species: species ?? SPECIES[0],
    eye: eye ?? EYES[0],
    rarity: rarity ?? RARITIES[0],
    hat: hat ?? 'crown',
    shiny: flags.shiny ?? false,
    peak: validateFlag('peak', flags.peak, STAT_NAMES) ?? null,
    dump: validateFlag('dump', flags.dump, STAT_NAMES) ?? null,
  };
}

async function selectTraits(flags: CliFlags): Promise<DesiredTraits> {
  if (allTraitsFlagged(flags) && flags.yes) {
    return buildDesiredFromFlags(flags);
  }

  // Try the OpenTUI builder
  try {
    const { canUseBuilder, runBuilder } = await import('../builder/index.ts');
    if (await canUseBuilder()) {
      const result = await runBuilder(flags);
      if (result === null) {
        throw new CancelledError();
      }
      return result;
    }
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    // OpenTUI import failed (e.g. running on Node) — fall through to sequential
  }

  // Show warning if Bun is not available
  if (typeof globalThis.Bun === 'undefined') {
    console.log(
      chalk.yellow(
        '  \u26A0  Bun is not installed — using basic prompts.\n' +
          '     Install Bun (https://bun.sh) for the interactive builder\n' +
          '     with live preview, and for correct hash cracking.\n',
      ),
    );
  }

  // Fallback: sequential prompts
  return runSequentialSelection(flags);
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

interface SetupResult {
  userId: string;
  binaryPath: string;
  useNodeHash: boolean;
}

function runSetup(): SetupResult {
  const preflight = runPreflight({ requireBinary: true });
  if (!preflight.ok || !preflight.binaryPath) {
    process.exit(1);
  }

  if (preflight.needsSudo && process.getuid?.() !== 0) {
    execWithSudo(preflight);
  }
  const userId = preflight.userId;
  const binaryPath = preflight.binaryPath;
  console.log(chalk.dim(`  User ID: ${userId.slice(0, 12)}...`));
  console.log(chalk.dim(`  Binary:  ${binaryPath} (salt found ${preflight.saltCount}x)`));

  const useNodeHash = isNodeRuntime(binaryPath);
  if (useNodeHash) {
    console.log(chalk.dim('  Runtime: Node (using FNV-1a hash — npm install detected)'));
  } else if (preflight.bunVersion) {
    console.log(chalk.dim(`  Bun:     v${preflight.bunVersion}`));
  }
  console.log();

  const currentBones = roll(userId, ORIGINAL_SALT, { useNodeHash }).bones;
  showPet(currentBones, 'Your current default pet');

  const existingConfig = loadPetConfig();
  if (existingConfig?.salt && existingConfig.salt !== ORIGINAL_SALT) {
    const patchedBones = roll(userId, existingConfig.salt, { useNodeHash }).bones;
    showPet(patchedBones, 'Your active patched pet');
  }

  return { userId, binaryPath, useNodeHash };
}

export async function runInteractive(
  flags: CliFlags = {},
  { skipBanner = false }: { skipBanner?: boolean } = {},
): Promise<void> {
  if (!skipBanner) banner();

  const { userId, binaryPath, useNodeHash } = runSetup();

  let desired: DesiredTraits;
  try {
    desired = await selectTraits(flags);
  } catch (err) {
    if (err instanceof CancelledError) {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
    throw err;
  }

  await applyDesiredTraits(desired, flags, { userId, binaryPath, useNodeHash });
}

export async function runInteractiveWithTraits(
  desired: DesiredTraits,
  flags: CliFlags = {},
): Promise<void> {
  const { userId, binaryPath, useNodeHash } = runSetup();
  await applyDesiredTraits(desired, flags, { userId, binaryPath, useNodeHash });
}

async function applyDesiredTraits(
  desired: DesiredTraits,
  flags: CliFlags,
  setup: SetupResult,
): Promise<void> {
  // Try the OpenTUI apply flow
  try {
    const { canUseBuilder } = await import('../builder/index.ts');
    if (await canUseBuilder()) {
      const { runApplyTUI } = await import('../apply/index.ts');
      await runApplyTUI(desired, flags, setup);
      return;
    }
  } catch {
    // OpenTUI unavailable — fall through to sequential
  }

  await applyDesiredTraitsSequential(desired, flags, setup);
}

async function applyDesiredTraitsSequential(
  desired: DesiredTraits,
  flags: CliFlags,
  { userId, binaryPath, useNodeHash }: SetupResult,
): Promise<void> {
  const existingConfig = loadPetConfig();

  // Show preview of what was selected
  const previewBones = { ...desired, stats: {} };
  showPet(previewBones, 'Your selection');

  const proceed =
    flags.yes ||
    (await confirm({
      message: 'Find a matching salt and apply?',
      default: true,
    }));

  if (!proceed) {
    console.log(chalk.dim('\n  Cancelled.\n'));
    return;
  }

  // Find salt
  const expected = estimateAttempts(desired);
  console.log(chalk.dim(`\n  Searching (~${formatCount(expected)} expected attempts)...`));

  const result = await findSalt(userId, desired, {
    binaryPath,
    onProgress: ({ attempts, rate, pct, eta, workers }) => {
      const bar = progressBar(pct, 20);
      const etaStr =
        eta < 1 ? '<1s' : eta < 60 ? `${Math.ceil(eta)}s` : `${(eta / 60).toFixed(1)}m`;
      const rateStr =
        rate > 1e6 ? `${(rate / 1e6).toFixed(1)}M/s` : `${(rate / 1e3).toFixed(0)}k/s`;
      const workerStr = workers > 1 ? chalk.dim(` [${workers} cores]`) : '';
      process.stdout.write(
        `\r  ${bar} ${chalk.dim(`${Math.min(99, Math.floor(pct))}%`)}  ${chalk.cyan(formatCount(attempts))} tried  ${chalk.dim(rateStr)}  ${chalk.dim(`ETA ${etaStr}`)}${workerStr}   `,
      );
    },
  });

  process.stdout.write('\r' + ' '.repeat(100) + '\r');
  const totalStr = result.totalAttempts
    ? ` (${result.totalAttempts.toLocaleString()} total across ${result.workers} cores)`
    : '';
  console.log(
    chalk.green(
      `  Found in ${result.attempts.toLocaleString()} attempts${totalStr} (${(result.elapsed / 1000).toFixed(1)}s)`,
    ),
  );
  const foundBones = roll(userId, result.salt, { useNodeHash }).bones;
  showPet(foundBones, 'Your new pet');

  // Patch binary
  const current = getCurrentSalt(binaryPath);
  let oldSalt: string;
  if (!current.patched) {
    oldSalt = ORIGINAL_SALT;
  } else if (existingConfig?.salt) {
    oldSalt = existingConfig.salt;
    const check = verifySalt(binaryPath, oldSalt);
    if (check.found < getMinSaltCount(binaryPath)) {
      console.error(chalk.red('  Cannot find current salt in binary. Try restoring first.'));
      return;
    }
  } else {
    console.error(
      chalk.red('  Binary appears patched but no previous salt on record. Try restoring first.'),
    );
    return;
  }

  // --- Save as profile (before patch decision — the salt search is the expensive part) ---
  const profileName = (
    await input({
      message: 'Save this buddy? (name, or blank to skip)',
      default: '',
    })
  ).trim();

  if (profileName) {
    saveProfile({
      salt: result.salt,
      species: foundBones.species,
      rarity: foundBones.rarity,
      eye: foundBones.eye,
      hat: foundBones.hat,
      shiny: foundBones.shiny,
      stats: foundBones.stats,
      name: profileName,
      personality: DEFAULT_PERSONALITIES[foundBones.species] ?? null,
      createdAt: new Date().toISOString(),
    });
    console.log(chalk.green(`  Saved buddy "${profileName}"`));
  }

  // --- Apply now? ---
  const running = isClaudeRunning(binaryPath);
  if (running) {
    console.log(chalk.yellow('\n  Claude Code is currently running.'));
    console.log(chalk.yellow('  The patch is safe (uses atomic rename — the running process'));
    console.log(chalk.yellow("  keeps using the old binary in memory), but the change won't"));
    console.log(chalk.yellow('  take effect until you restart Claude Code.\n'));
  }

  const applyNow =
    flags.yes ||
    (await confirm({
      message: running
        ? "Patch binary? (you'll need to restart Claude Code after)"
        : 'Patch binary? (backup will be created)',
      default: true,
    }));

  if (!applyNow) {
    if (profileName) {
      console.log(chalk.dim('  Use any-buddy buddies to activate it later.\n'));
    } else {
      console.log(chalk.dim('  Not saved. Run any-buddy again to find another.\n'));
    }
    return;
  }

  const patchResult = patchBinary(binaryPath, oldSalt, result.salt);
  console.log(
    chalk.green(
      `  Patched! ${patchResult.replacements} replacements, verified: ${patchResult.verified}`,
    ),
  );
  if (patchResult.codesigned) {
    console.log(chalk.dim('  Re-signed for macOS.'));
  } else {
    warnCodesign(patchResult, binaryPath);
  }
  console.log(chalk.dim(`  Backup: ${patchResult.backupPath}`));

  // Persist as v2 config (preserves existing profiles)
  const configV2 = loadPetConfigV2() ?? {
    version: 2 as const,
    activeProfile: null,
    salt: ORIGINAL_SALT,
    profiles: {},
  };
  configV2.salt = result.salt;
  configV2.previousSalt = oldSalt;
  configV2.appliedTo = binaryPath;
  configV2.appliedAt = new Date().toISOString();
  if (profileName) {
    configV2.activeProfile = result.salt;
  }
  savePetConfigV2(configV2);

  // Hook setup
  if (!isHookInstalled() && !flags.noHook) {
    console.log(
      chalk.dim(
        '\n  Optional: install a SessionStart hook to auto-re-apply after Claude Code updates.',
      ),
    );
    console.log(
      chalk.yellow('  Note: this modifies ~/.claude/settings.json. If you have issues, run:'),
    );
    console.log(chalk.yellow('  any-buddy restore'));

    const setupHook = await confirm({
      message: 'Install auto-patch hook?',
      default: false,
    });

    if (setupHook) {
      installHook();
      console.log(chalk.green('  Hook installed in ~/.claude/settings.json'));
    } else {
      console.log(chalk.dim('  No hook installed. Run `any-buddy apply` manually after updates.'));
    }
  } else if (isHookInstalled()) {
    console.log(chalk.dim('  SessionStart hook already installed.'));
  }

  // Rename & Personality
  const currentName = getCompanionName();
  const currentPersonality = getCompanionPersonality();
  const hasCompanion = !!(currentName && currentPersonality);

  if (hasCompanion) {
    const newName =
      flags.name ??
      (await input({
        message: `Rename your companion? (current: "${currentName}", leave blank to keep)`,
        default: '',
      }));

    if (newName && newName !== currentName) {
      try {
        renameCompanion(newName);
        console.log(chalk.green(`  Renamed "${currentName}" → "${newName}"`));
      } catch (err) {
        console.log(chalk.yellow(`  Could not rename: ${(err as Error).message}`));
      }
    }

    console.log(chalk.dim(`\n  Current personality: "${currentPersonality}"`));

    const speciesDefault = DEFAULT_PERSONALITIES[foundBones.species] || null;

    let newPersonality: string | undefined = flags.personality;
    if (!newPersonality) {
      const choices: { name: string; value: string }[] = [{ name: 'Keep current', value: 'keep' }];
      if (speciesDefault) {
        choices.push({
          name: `Use ${foundBones.species} default: "${speciesDefault.slice(0, 60)}..."`,
          value: 'default',
        });
      }
      choices.push({ name: 'Write custom', value: 'custom' });

      const choice = await select({ message: 'Personality', choices });

      if (choice === 'default') {
        newPersonality = speciesDefault ?? undefined;
      } else if (choice === 'custom') {
        newPersonality = await input({
          message: "Describe your companion's personality",
        });
      }
    }

    if (newPersonality && newPersonality !== currentPersonality) {
      try {
        setCompanionPersonality(newPersonality);
        console.log(chalk.green('  Personality updated.'));
      } catch (err) {
        console.log(chalk.yellow(`  Could not update personality: ${(err as Error).message}`));
      }
    }
  } else {
    console.log(chalk.dim('\n  No companion hatched yet — the visual patch has been applied.'));
    console.log(
      chalk.dim(
        '  Run /buddy in Claude Code to hatch your companion and get a name & personality.',
      ),
    );
    console.log(chalk.dim('  Then run any-buddy again to customize the name and personality.'));
    if (flags.name || flags.personality) {
      console.log(chalk.yellow('  --name and --personality are ignored until after hatching.'));
    }
  }

  // Update profile with final companion identity (now that rename/personality are done)
  if (profileName) {
    const saved = configV2.profiles[result.salt];
    if (saved) {
      saved.name = profileName || getCompanionName() || saved.name;
      saved.personality = getCompanionPersonality() ?? saved.personality;
      saveProfile(saved, { activate: true });
    }
  }

  if (running) {
    console.log(
      chalk.bold.yellow(
        '\n  Done! Quit all Claude Code sessions and relaunch to see your new pet.',
      ),
    );
    console.log(chalk.dim('  Then run /buddy to meet your new companion.'));
  } else {
    console.log(
      chalk.bold.green('\n  Done! Launch Claude Code and run /buddy to see your new pet.'),
    );
  }
  console.log(
    chalk.dim('\n  If you enjoyed this, star the repo: https://github.com/cpaczek/any-buddy\n'),
  );
}
