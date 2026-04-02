#!/usr/bin/env node

import { runInteractive, runPreview, runCurrent, runApply, runRestore, runRehatch } from '../lib/tui.mjs';
import { ISSUE_URL, diagnostics } from '../lib/constants.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--species' || arg === '-s') { flags.species = args[++i]; }
    else if (arg === '--rarity' || arg === '-r') { flags.rarity = args[++i]; }
    else if (arg === '--eye' || arg === '-e') { flags.eye = args[++i]; }
    else if (arg === '--hat' || arg === '-t') { flags.hat = args[++i]; }
    else if (arg === '--name' || arg === '-n') { flags.name = args[++i]; }
    else if (arg === '--personality' || arg === '-p') { flags.personality = args[++i]; }
    else if (arg === '--preset') { flags.preset = args[++i]; }
    else if (arg === '--shiny') { flags.shiny = true; }
    else if (arg === '--peak') { flags.peak = args[++i]; }
    else if (arg === '--dump') { flags.dump = args[++i]; }
    else if (arg === '--silent') { flags.silent = true; }
    else if (arg === '--no-hook') { flags.noHook = true; }
    else if (arg === '--yes' || arg === '-y') { flags.yes = true; }
    else if (!arg.startsWith('-')) { positional.push(arg); }
  }

  return { command: positional[0], flags };
}

const { command, flags } = parseArgs(process.argv);

try {
  switch (command) {
    case 'apply':
      await runApply({ silent: flags.silent });
      break;
    case 'preview':
      await runPreview(flags);
      break;
    case 'current':
      await runCurrent();
      break;
    case 'restore':
      await runRestore();
      break;
    case 'rehatch':
      await runRehatch();
      break;
    case 'help':
      printHelp();
      break;
    default:
      if (command === '--help' || command === '-h') { printHelp(); break; }
      await runInteractive(flags);
      break;
  }
} catch (err) {
  if (err.name === 'ExitPromptError') {
    process.exit(0);
  }
  console.error(`\n  Error: ${err.message}`);
  // If the error message doesn't already include the issue URL, add it
  if (!err.message.includes('github.com/cpaczek/any-buddy')) {
    console.error(`\n  If this seems like a bug, please report it at:\n  ${ISSUE_URL}`);
    console.error(`\n  Please include the full error output above and:`);
    console.error(diagnostics({ Args: process.argv.slice(2).join(' ') || '(none)' }));
  }
  process.exit(1);
}

function printHelp() {
  console.log(`
any-buddy — Pick any Claude Code companion pet

Usage:
  any-buddy                          Interactive pet picker
  any-buddy --species dragon         Skip species prompt
  any-buddy -s cat -r legendary -e ✦ -t wizard -y
                                     Fully non-interactive
  any-buddy --preset "Arcane Dragon"  Use a curated preset build
  any-buddy preview                  Browse pets without applying
  any-buddy current                  Show your current pet
  any-buddy apply [--silent]         Re-apply saved pet after update
  any-buddy restore                  Restore original pet
  any-buddy rehatch                  Delete companion to re-hatch via /buddy

Options:
  --preset <name>        Use a curated preset (e.g., "Arcane Dragon", "Royal Capybara")
  -s, --species <name>   Species (duck, goose, blob, cat, dragon, octopus, owl,
                         penguin, turtle, snail, ghost, axolotl, capybara,
                         cactus, robot, rabbit, mushroom, chonk)
  -r, --rarity <level>   Rarity (common, uncommon, rare, epic, legendary)
  -e, --eye <char>       Eye style (· ✦ × ◉ @ °)
  -t, --hat <name>       Hat (none, crown, tophat, propeller, halo, wizard,
                         beanie, tinyduck)
  -n, --name <name>      Rename your companion
  -p, --personality <desc>  Set companion personality
  --shiny                Require shiny (~100x longer search)
  --peak <stat>          Best stat (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK)
  --dump <stat>          Worst stat (~20x longer search with both)
  -y, --yes              Skip confirmation prompts
  --no-hook              Don't offer to install the SessionStart hook
  --silent               Suppress output (for apply command in hooks)

Environment:
  CLAUDE_BINARY          Path to Claude Code binary (auto-detected by default)
`);
}
