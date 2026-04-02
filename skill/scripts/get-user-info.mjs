#!/usr/bin/env node
// Reads Claude Code user ID and current companion info.
// No external dependencies.
//
// Usage: node get-user-info.mjs
// Output: JSON with userId, companion name, personality, and saved config

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const home = homedir();

// Read user ID
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

// Read companion info
function getCompanion() {
  const paths = [join(home, '.claude.json'), join(home, '.claude', '.config.json')];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        return config.companion ?? null;
      } catch { continue; }
    }
  }
  return null;
}

// Read any-buddy saved config
function getSavedConfig() {
  const p = join(home, '.claude-code-any-buddy.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch { return null; }
}

const result = {
  userId: getUserId(),
  companion: getCompanion(),
  savedConfig: getSavedConfig(),
};

console.log(JSON.stringify(result, null, 2));
