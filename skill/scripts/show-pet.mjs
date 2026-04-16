#!/usr/bin/env node
// Shows current pet traits by rolling userId + salt through the generation logic.
// No external dependencies — uses vendored wyhash WASM or FNV-1a.
//
// Usage: node show-pet.mjs [--fnv1a]
// Output: JSON with defaultPet (original salt) and patchedPet (if patched)
//
// Pass --fnv1a when the Claude binary runs under Node (e.g., Windows npm installs).

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  SPECIES, EYES, HATS, STAT_NAMES, RARITY_STARS, ORIGINAL_SALT,
  mulberry32, pick, rollRarity, getHashFn,
} from './shared.mjs';

const useFnv1a = process.argv.includes('--fnv1a');

const home = homedir();

function rollPet(userId, salt, hashFn) {
  const key = userId + salt;
  const seed = hashFn(key);
  const rng = mulberry32(seed);
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS);
  const shiny = rng() < 0.01;
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);
  return { species, rarity, stars: RARITY_STARS[rarity], eye, hat, shiny, peak, dump };
}

function getUserId() {
  const paths = [join(home, '.claude.json'), join(home, '.claude', '.config.json')];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon';
      } catch { continue; }
    }
  }
  return 'anon';
}

function getSavedConfig() {
  const p = join(home, '.claude-code-any-buddy.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch { return null; }
}

try {
  const userId = getUserId();
  const config = getSavedConfig();
  const hashFn = await getHashFn(useFnv1a);

  const result = {
    hashMode: useFnv1a ? 'fnv1a' : 'wyhash',
    defaultPet: rollPet(userId, ORIGINAL_SALT, hashFn),
  };

  if (config?.salt && config.salt !== ORIGINAL_SALT) {
    result.patchedPet = rollPet(userId, config.salt, hashFn);
    result.isPatched = true;
  } else {
    result.isPatched = false;
  }

  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
