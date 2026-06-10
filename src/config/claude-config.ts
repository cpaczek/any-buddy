import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function getClaudeConfigPath(): string {
  const paths = [join(homedir(), '.claude.json'), join(homedir(), '.claude', '.config.json')];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return paths[0];
}

export function getClaudeUserId(): string {
  const paths = [join(homedir(), '.claude.json'), join(homedir(), '.claude', '.config.json')];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        return (config.oauthAccount?.accountUuid as string) ?? (config.userID as string) ?? 'anon';
      } catch {
        continue;
      }
    }
  }

  return 'anon';
}

export function getCompanionName(): string | null {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return (config.companion?.name as string) ?? null;
  } catch {
    return null;
  }
}

export function renameCompanion(newName: string): void {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Claude config not found at ${configPath}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    throw new Error(`Failed to parse Claude config at ${configPath}`);
  }
  if (!config.companion) {
    throw new Error('No companion found in config. Run /hatch in Claude Code first to hatch one.');
  }
  config.companion.name = newName;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function getCompanionPersonality(): string | null {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return (config.companion?.personality as string) ?? null;
  } catch {
    return null;
  }
}

export function setCompanionPersonality(personality: string): void {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Claude config not found at ${configPath}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    throw new Error(`Failed to parse Claude config at ${configPath}`);
  }
  if (!config.companion) {
    throw new Error('No companion found in config. Run /hatch in Claude Code first to hatch one.');
  }
  config.companion.personality = personality;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function deleteCompanion(): boolean {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return false;
  }
  if (!config.companion) return false;
  delete config.companion;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return true;
}
