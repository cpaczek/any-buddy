import { spawnSync } from 'child_process';
import chalk from 'chalk';
import { ORIGINAL_SALT, RARITY_STARS } from '@/constants.js';
import { roll } from '@/generation/index.js';
import { findClaudeBinary } from '@/patcher/binary-finder.js';
import { isNodeRuntime } from '@/patcher/salt-ops.js';
import { runPreflight } from '@/patcher/preflight.js';
import { loadPetConfigV2, getCompanionName } from '@/config/index.js';
import { renderSprite } from '@/sprites/index.js';
import type { Bones } from '@/types.js';
import { RARITY_CHALK } from '../format.ts';

const STAT_BAR_WIDTH = 10;

function statBar(value: number): string {
  const filled = Math.round((value / 100) * STAT_BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(STAT_BAR_WIDTH - filled);
}

function buildCard(bones: Bones, companionName: string | null): string {
  const stars = RARITY_STARS[bones.rarity] ?? '';
  const shinyTag = bones.shiny ? '  ✨ shiny' : '';
  const lines: string[] = [];

  // Header
  if (companionName) {
    lines.push(`${companionName}  ·  ${bones.species} ${stars}${shinyTag}`);
  } else {
    lines.push(`${bones.species} ${stars}${shinyTag}`);
  }
  lines.push(`rarity: ${bones.rarity}   eyes: ${bones.eye}   hat: ${bones.hat}`);
  lines.push('');

  // Sprite (strip trailing spaces so the box isn't too wide)
  const spriteLines = renderSprite(bones, 0).map((l) => l.trimEnd());
  lines.push(...spriteLines);

  // Stats (always rolled, show all five)
  const statEntries = Object.entries(bones.stats) as [string, number][];
  if (statEntries.length > 0) {
    lines.push('');
    const maxName = Math.max(...statEntries.map(([k]) => k.length));
    const sorted = [...statEntries].sort((a, b) => b[1] - a[1]);
    for (const [name, val] of sorted) {
      lines.push(`${name.padEnd(maxName)}  ${statBar(val)}  ${val}`);
    }
  }

  lines.push('');
  lines.push('made with any-buddy — github.com/cpaczek/any-buddy');

  // Box
  const innerWidth = Math.max(...lines.map((l) => l.length));
  const rule = '─'.repeat(innerWidth + 4);
  const top = '╭' + rule + '╮';
  const bot = '╰' + rule + '╯';
  const boxLines = lines.map((l) => '│  ' + l.padEnd(innerWidth) + '  │');

  return [top, ...boxLines, bot].join('\n');
}

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      return spawnSync('pbcopy', [], { input: text }).status === 0;
    } else if (process.platform === 'win32') {
      return spawnSync('clip', [], { input: text, shell: true }).status === 0;
    } else {
      // Linux: try xclip, fall back to xsel
      if (spawnSync('xclip', ['-selection', 'clipboard'], { input: text }).status === 0) {
        return true;
      }
      return spawnSync('xsel', ['--clipboard', '--input'], { input: text }).status === 0;
    }
  } catch {
    return false;
  }
}

export async function runShare(): Promise<void> {
  const preflight = await runPreflight({ requireBinary: false });
  if (!preflight.ok) process.exit(1);

  const userId = preflight.userId;

  let useNodeHash = false;
  try {
    const bp = findClaudeBinary();
    useNodeHash = isNodeRuntime(bp);
  } catch {
    // binary not required for share
  }

  const config = loadPetConfigV2();
  const activeSalt = config?.salt ?? ORIGINAL_SALT;
  const { bones } = roll(userId, activeSalt, { useNodeHash });

  const companionName = getCompanionName();
  const card = buildCard(bones, companionName);

  const rarityColor = RARITY_CHALK[bones.rarity] ?? chalk.white;
  console.log(
    '\n' +
      card
        .split('\n')
        .map((l) => rarityColor('  ' + l))
        .join('\n'),
  );

  const copied = copyToClipboard(card);
  if (copied) {
    console.log(chalk.green('\n  Copied to clipboard!'));
  } else {
    console.log(chalk.dim('\n  (Copy the card above to share it)'));
  }
  console.log();
}
