import type { Species, Rarity, Eye, Hat } from './types.ts';

export interface Preset {
  name: string;
  description: string;
  species: Species;
  rarity: Rarity;
  eye: Eye;
  hat: Hat;
}

// Curated preset builds — themed pet combos users can pick in one step.
// At least one preset per species so every pet type is represented.
export const PRESETS: readonly Preset[] = [
  // ─── Dragon ───
  {
    name: 'Arcane Dragon',
    description: 'A legendary wizard dragon with starry eyes',
    species: 'dragon',
    rarity: 'legendary',
    eye: '✦',
    hat: 'wizard',
  },
  {
    name: 'Dragon King',
    description: 'An epic crowned dragon — ruler of all pets',
    species: 'dragon',
    rarity: 'epic',
    eye: '◉',
    hat: 'crown',
  },
  // ─── Cat ───
  {
    name: 'Cozy Cat',
    description: 'A rare beanie cat with dreamy eyes',
    species: 'cat',
    rarity: 'rare',
    eye: '°',
    hat: 'beanie',
  },
  {
    name: 'Witch Cat',
    description: 'A legendary wizard cat — familiar vibes',
    species: 'cat',
    rarity: 'legendary',
    eye: '✦',
    hat: 'wizard',
  },
  // ─── Capybara ───
  {
    name: 'Royal Capybara',
    description: 'An epic crowned capybara — chill royalty',
    species: 'capybara',
    rarity: 'epic',
    eye: '◉',
    hat: 'crown',
  },
  {
    name: 'Zen Capybara',
    description: 'A common capybara — maximum chill, no frills',
    species: 'capybara',
    rarity: 'common',
    eye: '·',
    hat: 'none',
  },
  // ─── Ghost ───
  {
    name: 'Ghost in the Shell',
    description: 'A rare halo ghost with hollow eyes',
    species: 'ghost',
    rarity: 'rare',
    eye: '°',
    hat: 'halo',
  },
  {
    name: 'Poltergeist',
    description: 'An epic propeller ghost — chaotic energy',
    species: 'ghost',
    rarity: 'epic',
    eye: '×',
    hat: 'propeller',
  },
  // ─── Penguin ───
  {
    name: 'Dapper Penguin',
    description: 'An epic penguin in a top hat — pure class',
    species: 'penguin',
    rarity: 'epic',
    eye: '·',
    hat: 'tophat',
  },
  // ─── Robot ───
  {
    name: 'Mad Scientist',
    description: 'A legendary robot with glitchy eyes and propeller',
    species: 'robot',
    rarity: 'legendary',
    eye: '×',
    hat: 'propeller',
  },
  {
    name: 'Robo-King',
    description: 'An epic crowned robot — all hail the machine',
    species: 'robot',
    rarity: 'epic',
    eye: '◉',
    hat: 'crown',
  },
  // ─── Duck ───
  {
    name: 'Chaos Duck',
    description: 'An uncommon duck with a tiny duck on its head',
    species: 'duck',
    rarity: 'uncommon',
    eye: '×',
    hat: 'tinyduck',
  },
  // ─── Goose ───
  {
    name: 'Horrible Goose',
    description: 'A rare goose with a halo — suspiciously innocent',
    species: 'goose',
    rarity: 'rare',
    eye: '·',
    hat: 'halo',
  },
  // ─── Owl ───
  {
    name: 'Mystic Owl',
    description: 'A legendary wizard owl with piercing gaze',
    species: 'owl',
    rarity: 'legendary',
    eye: '◉',
    hat: 'wizard',
  },
  // ─── Mushroom ───
  {
    name: 'Spore Lord',
    description: 'An epic crowned mushroom — ruler of the forest floor',
    species: 'mushroom',
    rarity: 'epic',
    eye: '✦',
    hat: 'crown',
  },
  // ─── Turtle ───
  {
    name: 'Tiny Tank',
    description: 'A rare turtle with a propeller — slow but airborne',
    species: 'turtle',
    rarity: 'rare',
    eye: '·',
    hat: 'propeller',
  },
  // ─── Blob ───
  {
    name: 'Blob Boss',
    description: 'An epic top-hat blob — formless but formal',
    species: 'blob',
    rarity: 'epic',
    eye: '✦',
    hat: 'tophat',
  },
  // ─── Octopus ───
  {
    name: 'Kraken',
    description: 'A legendary crowned octopus — terror of the deep',
    species: 'octopus',
    rarity: 'legendary',
    eye: '◉',
    hat: 'crown',
  },
  // ─── Axolotl ───
  {
    name: 'Angel Axolotl',
    description: 'A rare halo axolotl — too pure for this world',
    species: 'axolotl',
    rarity: 'rare',
    eye: '✦',
    hat: 'halo',
  },
  // ─── Snail ───
  {
    name: 'Wizard Snail',
    description: 'A rare wizard snail — slow-cast spells only',
    species: 'snail',
    rarity: 'rare',
    eye: '✦',
    hat: 'wizard',
  },
  // ─── Cactus ───
  {
    name: 'Desert Sage',
    description: 'A rare wizard cactus — prickly wisdom',
    species: 'cactus',
    rarity: 'rare',
    eye: '°',
    hat: 'wizard',
  },
  // ─── Rabbit ───
  {
    name: 'Top Hat Bunny',
    description: 'An epic rabbit in a top hat — pulled from it, now wears it',
    species: 'rabbit',
    rarity: 'epic',
    eye: '·',
    hat: 'tophat',
  },
  // ─── Chonk ───
  {
    name: 'Absolute Unit',
    description: 'A legendary crowned chonk — maximum gravitational presence',
    species: 'chonk',
    rarity: 'legendary',
    eye: '◉',
    hat: 'crown',
  },
] as const;
