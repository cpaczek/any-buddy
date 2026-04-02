export type Species =
  | 'duck'
  | 'goose'
  | 'blob'
  | 'cat'
  | 'dragon'
  | 'octopus'
  | 'owl'
  | 'penguin'
  | 'turtle'
  | 'snail'
  | 'ghost'
  | 'axolotl'
  | 'capybara'
  | 'cactus'
  | 'robot'
  | 'rabbit'
  | 'mushroom'
  | 'chonk';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type Eye = '·' | '✦' | '×' | '◉' | '@' | '°';

export type Hat =
  | 'none'
  | 'crown'
  | 'tophat'
  | 'propeller'
  | 'halo'
  | 'wizard'
  | 'beanie'
  | 'tinyduck';

export type StatName = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

export interface Bones {
  species: Species;
  rarity: Rarity;
  eye: Eye;
  hat: Hat;
  shiny: boolean;
  stats: Partial<Record<StatName, number>>;
}

export interface RollResult {
  bones: Bones;
  inspirationSeed: number;
}

export interface DesiredTraits {
  species: Species;
  rarity: Rarity;
  eye: Eye;
  hat: Hat;
  shiny: boolean;
  peak: StatName | null;
  dump: StatName | null;
}

export interface FinderResult {
  salt: string;
  attempts: number;
  elapsed: number;
  totalAttempts?: number;
  workers?: number;
}

export interface FinderProgress {
  attempts: number;
  elapsed: number;
  rate: number;
  expected: number;
  pct: number;
  eta: number;
  workers: number;
}

export interface SaltState {
  salt: string | null;
  patched: boolean;
  offsets: number[];
}

export interface PatchResult {
  replacements: number;
  verified: boolean;
  backupPath: string;
  codesigned: boolean;
  codesignError: string | null;
}

export interface PreflightResult {
  ok: boolean;
  binaryPath: string | null;
  userId: string;
  saltCount: number;
  bunVersion: string | null;
}

export interface PetConfig {
  salt: string;
  previousSalt?: string;
  species?: Species;
  rarity?: Rarity;
  eye?: Eye;
  hat?: Hat;
  appliedTo?: string;
  appliedAt?: string;
  restored?: boolean;
}

export interface CliFlags {
  species?: string;
  rarity?: string;
  eye?: string;
  hat?: string;
  name?: string;
  personality?: string;
  preset?: string;
  shiny?: boolean;
  peak?: string;
  dump?: string;
  silent?: boolean;
  noHook?: boolean;
  yes?: boolean;
}

export type RngFunction = () => number;
