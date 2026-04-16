import chalk from 'chalk';
import type { CliFlags } from '@/types.js';
import { SPECIES, EYES, RARITIES, HATS, RARITY_STARS } from '@/constants.js';
import { runPreflight } from '@/patcher/preflight.js';
import { banner, showPet } from '../display.ts';
import { validateFlag, selectSpecies, selectEyes, selectRarity, selectHat } from '../prompts.ts';
import { allTraitsFlagged } from '../builder/state.ts';
import { PRESETS } from '@/presets.js';
import { renderSprite } from '@/sprites/index.js';
import { RARITY_CHALK } from '../format.ts';

function runPreviewAll(): void {
  const cols = process.stdout.columns ?? 80;
  const rule = chalk.dim('  ' + '─'.repeat(Math.min(Math.max(0, cols - 4), 60)));

  console.log(chalk.bold(`\n  Preset gallery  `) + chalk.dim(`(${PRESETS.length} presets)\n`));

  for (let i = 0; i < PRESETS.length; i++) {
    const p = PRESETS[i];
    const color = RARITY_CHALK[p.rarity] ?? chalk.white;
    const stars = RARITY_STARS[p.rarity] ?? '';
    const bones = {
      species: p.species,
      eye: p.eye,
      hat: p.hat,
      rarity: p.rarity,
      shiny: false,
      stats: {},
    };
    const spriteLines = renderSprite(bones, 0);

    console.log(color(`  ${p.name}  ·  ${p.rarity} ${p.species}  ${stars}`));
    console.log(chalk.dim(`  eyes: ${p.eye}   hat: ${p.hat}   "${p.description}"`));
    console.log();
    for (const line of spriteLines) {
      console.log(color('    ' + line));
    }
    console.log();

    if (i < PRESETS.length - 1) {
      console.log(rule);
      console.log();
    }
  }

  console.log(
    chalk.dim(
      `  ${PRESETS.length} presets total. Run 'any-buddy --preset "<name>"' to apply one.\n`,
    ),
  );
}

async function runSequentialPreview(flags: CliFlags): Promise<void> {
  const species = validateFlag('species', flags.species, SPECIES) ?? (await selectSpecies());
  const eye = validateFlag('eye', flags.eye, EYES) ?? (await selectEyes(species));
  const rarity = validateFlag('rarity', flags.rarity, RARITIES) ?? (await selectRarity());
  const hat =
    rarity === 'common'
      ? ('none' as const)
      : (validateFlag('hat', flags.hat, HATS) ?? (await selectHat(species, eye, rarity)));

  const shiny = flags.shiny ?? false;
  const bones = { species, eye, hat, rarity, shiny, stats: {} };
  showPet(bones, 'Preview');
  console.log(chalk.dim('  (Preview only - no changes made)\n'));
}

export async function runPreview(flags: CliFlags = {}): Promise<void> {
  banner();

  if (flags.all) {
    runPreviewAll();
    return;
  }

  const preflight = await runPreflight({ requireBinary: false });
  if (!preflight.ok) process.exit(1);

  if (allTraitsFlagged(flags)) {
    // All traits specified via flags -- just render directly
    const species = validateFlag('species', flags.species, SPECIES) ?? SPECIES[0];
    const eye = validateFlag('eye', flags.eye, EYES) ?? EYES[0];
    const rarity = validateFlag('rarity', flags.rarity, RARITIES) ?? RARITIES[0];
    const hat =
      rarity === 'common' ? ('none' as const) : (validateFlag('hat', flags.hat, HATS) ?? 'crown');

    const bones = { species, eye, hat, rarity, shiny: flags.shiny ?? false, stats: {} };
    showPet(bones, 'Preview');
    console.log(chalk.dim('  (Preview only - no changes made)\n'));
    return;
  }

  // Try the OpenTUI builder in browse-only mode
  try {
    const { canUseBuilder, runBuilder } = await import('../builder/index.ts');
    if (await canUseBuilder()) {
      await runBuilder(flags, true);
      console.log(chalk.dim('  (Preview only - no changes made)\n'));
      return;
    }
  } catch {
    // OpenTUI unavailable -- fall through
  }

  // Show warning if Bun is not available
  if (typeof globalThis.Bun === 'undefined') {
    console.log(
      chalk.yellow(
        '  \u26A0  Bun is not installed — using basic prompts.\n' +
          '     Install Bun (https://bun.sh) for the interactive builder\n' +
          '     with live preview.\n',
      ),
    );
  }

  // Fallback: sequential prompts
  await runSequentialPreview(flags);
}
