import chalk from 'chalk';
import { execSync } from 'child_process';
import { select } from '@inquirer/prompts';
import { ORIGINAL_SALT, RARITY_STARS } from '@/constants.js';
import { roll } from '@/generation/index.js';
import { DEFAULT_PERSONALITIES } from '@/personalities.js';
import { isNodeRuntime, verifySalt, isClaudeRunning, getMinSaltCount } from '@/patcher/salt-ops.js';
import { patchBinary } from '@/patcher/patch.js';
import { runPreflight } from '@/patcher/preflight.js';
import {
  loadPetConfigV2,
  savePetConfigV2,
  switchToProfile,
  saveProfile,
  deleteProfile,
  getCompanionName,
  renameCompanion,
  getCompanionPersonality,
  setCompanionPersonality,
} from '@/config/index.js';
import { banner, showPet, warnCodesign } from '@/tui/display.js';
import {
  buildGalleryEntries,
  activeEntryIndex,
  DEFAULT_PROFILE,
  type GalleryEntry,
} from '@/tui/gallery/state.js';

async function selectBuddyFallback(entries: GalleryEntry[]): Promise<string | null> {
  const choices = entries.map((entry) => {
    const dot = entry.isActive ? '●' : '○';
    const stars = RARITY_STARS[entry.bones.rarity];
    return {
      name: `${dot} ${entry.name} — ${entry.bones.species} ${stars}`,
      value: entry.salt,
    };
  });

  const choice = await select({
    message: 'Choose a buddy',
    choices,
  });

  return choice;
}

export async function runBuddies(): Promise<void> {
  banner();

  const preflight = runPreflight({ requireBinary: true });
  if (!preflight.ok || !preflight.binaryPath) {
    process.exit(1);
  }

  if (preflight.needsSudo && process.getuid?.() !== 0) {
    const args = process.argv.slice(1);
    console.log(chalk.yellow('  Binary requires elevated permissions. Re-running with sudo...\n'));
    try {
      execSync(`sudo ${process.execPath} ${args.map((a) => `"${a}"`).join(' ')}`, {
        stdio: 'inherit',
      });
      process.exit(0);
    } catch {
      console.error(chalk.red('  Sudo failed. Try: sudo any-buddy'));
      process.exit(1);
    }
  }

  const config = loadPetConfigV2();
  const profiles = config?.profiles ?? {};

  if (Object.keys(profiles).length === 0) {
    console.log(chalk.dim('  No saved buddies. Run any-buddy to create one.\n'));
    return;
  }

  const userId = preflight.userId;
  const binaryPath = preflight.binaryPath;
  const entries = buildGalleryEntries(userId, binaryPath);
  const startIndex = activeEntryIndex(entries);

  // Try OpenTUI gallery, fallback to sequential
  let selectedName: string | null = null;

  try {
    const { canUseGalleryTUI, runGalleryTUI } = await import('../gallery/index.ts');
    if (await canUseGalleryTUI()) {
      const result = await runGalleryTUI(entries, startIndex, (name) => {
        deleteProfile(name);
        return buildGalleryEntries(userId, binaryPath);
      });
      if (result.action === 'cancel') {
        console.log(chalk.dim('\n  Cancelled.\n'));
        return;
      }
      selectedName = result.profileName;
    }
  } catch {
    // OpenTUI not available — fall through
  }

  if (selectedName === null) {
    try {
      selectedName = await selectBuddyFallback(entries);
    } catch {
      console.log(chalk.dim('\n  Cancelled.\n'));
      return;
    }
  }

  if (!selectedName) {
    console.log(chalk.dim('\n  Cancelled.\n'));
    return;
  }

  // selectedName is now a salt (or DEFAULT_PROFILE)
  const selectedSalt = selectedName;

  // Skip if already active
  const selectedEntry = entries.find((e) => e.salt === selectedSalt);
  if (selectedEntry?.isActive) {
    console.log(chalk.dim('\n  Already active.\n'));
    return;
  }

  // Snapshot outgoing profile's companion identity
  const activeSalt = config?.activeProfile;
  if (activeSalt && config?.profiles[activeSalt]) {
    const outgoing = config.profiles[activeSalt];
    outgoing.name = getCompanionName() ?? outgoing.name;
    outgoing.personality = getCompanionPersonality() ?? outgoing.personality;
    saveProfile(outgoing);
  }

  // Find the old salt in binary
  const oldSalt = config?.salt ?? ORIGINAL_SALT;
  const isDefault = selectedSalt === DEFAULT_PROFILE;
  const newSalt = isDefault ? ORIGINAL_SALT : selectedSalt;

  if (!isDefault && !config?.profiles[selectedSalt]) {
    console.error(chalk.red('\n  Buddy not found.\n'));
    return;
  }

  // Patch binary
  let patched = false;
  for (const trySalt of [oldSalt, ORIGINAL_SALT]) {
    if (!trySalt) continue;
    const check = verifySalt(binaryPath, trySalt);
    if (check.found >= getMinSaltCount(binaryPath)) {
      const patchResult = patchBinary(binaryPath, trySalt, newSalt);
      const displayName = selectedEntry?.name ?? 'Unknown';
      console.log(
        chalk.green(`\n  Switched to "${displayName}"! (${patchResult.replacements} replacements)`),
      );
      warnCodesign(patchResult, binaryPath);
      patched = true;
      break;
    }
  }

  if (!patched) {
    console.error(
      chalk.red('\n  Could not find known salt in binary. Try running: any-buddy restore'),
    );
    return;
  }

  // Update config
  if (isDefault) {
    if (config) {
      config.previousSalt = config.salt;
      config.activeProfile = null;
      config.salt = newSalt;
      config.appliedAt = new Date().toISOString();
      savePetConfigV2(config);
    }
  } else {
    switchToProfile(selectedSalt);
  }

  // Restore incoming profile's companion identity
  if (!isDefault) {
    const incoming = config?.profiles[selectedSalt];
    if (incoming?.name) {
      try {
        renameCompanion(incoming.name);
      } catch (err) {
        console.log(chalk.dim(`  Could not restore name: ${(err as Error).message}`));
      }
    }
    const personality =
      incoming?.personality ?? DEFAULT_PERSONALITIES[incoming?.species ?? 'duck'] ?? null;
    if (personality) {
      try {
        setCompanionPersonality(personality);
      } catch (err) {
        console.log(chalk.dim(`  Could not restore personality: ${(err as Error).message}`));
      }
    }
  }

  // Show the new pet
  const useNodeHash = isNodeRuntime(binaryPath);
  const newBones = roll(userId, newSalt, { useNodeHash }).bones;
  showPet(newBones, 'Active pet');

  if (isClaudeRunning(binaryPath)) {
    console.log(chalk.yellow('  Restart Claude Code for the change to take effect.'));
  }
  console.log();
}
