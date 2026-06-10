import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { getCompanionName, getCompanionPersonality, deleteCompanion } from '@/config/index.js';
import { banner } from '../display.ts';

export async function runRehatch(): Promise<void> {
  banner();

  const name = getCompanionName();
  if (!name) {
    console.log(chalk.dim('  No companion found — nothing to delete.\n'));
    return;
  }

  const personality = getCompanionPersonality();
  console.log(chalk.dim(`  Current companion: "${name}"`));
  if (personality) {
    console.log(chalk.dim(`  Personality: "${personality}"`));
  }
  console.log();

  const proceed = await confirm({
    message: `Delete "${name}" so Claude Code generates a fresh companion on next /hatch?`,
    default: false,
  });

  if (!proceed) {
    console.log(chalk.dim('\n  Cancelled.\n'));
    return;
  }

  deleteCompanion();
  console.log(chalk.green(`\n  Companion "${name}" deleted.`));
  console.log(chalk.dim('  Run /hatch in Claude Code to hatch a new one.\n'));
}
