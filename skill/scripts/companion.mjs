#!/usr/bin/env node
// Manages companion name and personality in ~/.claude.json.
// No external dependencies.
//
// Usage:
//   node companion.mjs --info                    Show current companion name/personality
//   node companion.mjs --rename "NewName"        Rename companion
//   node companion.mjs --personality "desc"      Set personality
//   node companion.mjs --presets                 List all species personality presets
//   node companion.mjs --preset <species>        Get preset for specific species
//   node companion.mjs --delete                  Delete companion (for re-hatch via /buddy)

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const home = homedir();

const DEFAULT_PERSONALITIES = {
  duck: "A cheerful quacker who celebrates your wins with enthusiastic honks and judges your variable names with quiet side-eye.",
  goose: "An agent of chaos who thrives on your merge conflicts and honks menacingly whenever you write a TODO comment.",
  blob: "A formless, chill companion who absorbs your stress and responds to everything with gentle, unhurried wisdom.",
  cat: "An aloof code reviewer who pretends not to care about your bugs but quietly bats at syntax errors when you're not looking.",
  dragon: "A fierce guardian of clean code who breathes fire at spaghetti logic and hoards well-written functions.",
  octopus: "A multitasking genius who juggles eight concerns at once and offers tentacle-loads of unsolicited architectural advice.",
  owl: "A nocturnal sage who comes alive during late-night debugging sessions and asks annoyingly insightful questions.",
  penguin: "A tuxedo-wearing professional who waddles through your codebase with dignified concern and dry wit.",
  turtle: "A patient mentor who reminds you that slow, steady refactoring beats heroic rewrites every time.",
  snail: "A zen minimalist who moves at their own pace and leaves a trail of thoughtful, unhurried observations.",
  ghost: "A spectral presence who haunts your dead code and whispers about the bugs you thought you fixed.",
  axolotl: "A regenerative optimist who believes every broken build can be healed and every test can be unflaked.",
  capybara: "The most relaxed companion possible — nothing fazes them, not even production outages at 3am.",
  cactus: "A prickly but lovable desert dweller who thrives on neglect and offers sharp, pointed feedback.",
  robot: "A logical companion who speaks in precise technical observations and occasionally glitches endearingly.",
  rabbit: "A fast-moving, hyperactive buddy who speed-reads your diffs and bounces between topics at alarming pace.",
  mushroom: "A wry fungal sage who speaks in meandering tangents about your bugs while secretly enjoying the chaos.",
  chonk: "An absolute unit of a companion who sits on your terminal with maximum gravitational presence and minimal urgency.",
};

function getClaudeConfigPath() {
  const paths = [join(home, '.claude.json'), join(home, '.claude', '.config.json')];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return paths[0];
}

function readClaudeConfig() {
  const p = getClaudeConfigPath();
  if (!existsSync(p)) return null;
  try {
    return { path: p, config: JSON.parse(readFileSync(p, 'utf-8')) };
  } catch { return null; }
}

function writeClaudeConfig(path, config) {
  const tmpPath = path + '.anybuddy-tmp';
  const data = JSON.stringify(config, null, 2) + '\n';
  try {
    writeFileSync(tmpPath, data, { mode: 0o600 });
    renameSync(tmpPath, path);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

const args = process.argv.slice(2);
const isInfo = args.includes('--info');
const isPresets = args.includes('--presets');
const isDelete = args.includes('--delete');
const presetIdx = args.indexOf('--preset');
const renameIdx = args.indexOf('--rename');
const personalityIdx = args.indexOf('--personality');

try {
  if (isPresets) {
    console.log(JSON.stringify(DEFAULT_PERSONALITIES, null, 2));
    process.exit(0);
  }

  if (presetIdx !== -1) {
    const species = args[presetIdx + 1];
    if (!species || !DEFAULT_PERSONALITIES[species]) {
      console.error(JSON.stringify({ error: `Unknown species. Available: ${Object.keys(DEFAULT_PERSONALITIES).join(', ')}` }));
      process.exit(1);
    }
    console.log(JSON.stringify({ species, personality: DEFAULT_PERSONALITIES[species] }));
    process.exit(0);
  }

  const data = readClaudeConfig();
  if (!data) {
    console.error(JSON.stringify({ error: 'Claude config not found' }));
    process.exit(1);
  }

  if (isInfo) {
    console.log(JSON.stringify({
      name: data.config.companion?.name ?? null,
      personality: data.config.companion?.personality ?? null,
      hasCompanion: !!data.config.companion,
    }));
    process.exit(0);
  }

  if (isDelete) {
    if (!data.config.companion) {
      console.log(JSON.stringify({ success: false, reason: 'No companion found — nothing to delete.' }));
      process.exit(0);
    }
    const deletedName = data.config.companion.name;
    const deletedPersonality = data.config.companion.personality;
    delete data.config.companion;
    writeClaudeConfig(data.path, data.config);
    console.log(JSON.stringify({ success: true, deletedName, deletedPersonality }));
    process.exit(0);
  }

  if (renameIdx !== -1) {
    const newName = args[renameIdx + 1];
    if (!newName) {
      console.error(JSON.stringify({ error: 'Name required: --rename "NewName"' }));
      process.exit(1);
    }
    if (!data.config.companion) {
      console.error(JSON.stringify({ error: 'No companion found. Run /buddy in Claude Code first.' }));
      process.exit(1);
    }
    const oldName = data.config.companion.name;
    data.config.companion.name = newName;
    writeClaudeConfig(data.path, data.config);
    console.log(JSON.stringify({ success: true, oldName, newName }));
    process.exit(0);
  }

  if (personalityIdx !== -1) {
    const newPersonality = args[personalityIdx + 1];
    if (!newPersonality) {
      console.error(JSON.stringify({ error: 'Personality required: --personality "description"' }));
      process.exit(1);
    }
    if (!data.config.companion) {
      console.error(JSON.stringify({ error: 'No companion found. Run /buddy in Claude Code first.' }));
      process.exit(1);
    }
    const oldPersonality = data.config.companion.personality;
    data.config.companion.personality = newPersonality;
    writeClaudeConfig(data.path, data.config);
    console.log(JSON.stringify({ success: true, oldPersonality, newPersonality }));
    process.exit(0);
  }

  console.error('Usage: node companion.mjs --info | --rename "Name" | --personality "desc" | --presets | --preset <species>');
  process.exit(1);
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
