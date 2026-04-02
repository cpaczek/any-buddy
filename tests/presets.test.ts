import { describe, it, expect } from 'vitest';
import { PRESETS } from '../src/presets.ts';
import { SPECIES, EYES, HATS, RARITIES } from '../src/constants.ts';

describe('presets', () => {
  it('should have at least one preset per species', () => {
    const covered = new Set(PRESETS.map((p) => p.species));
    for (const species of SPECIES) {
      expect(covered.has(species), `missing preset for species: ${species}`).toBe(true);
    }
  });

  it('should only use valid species, rarity, eye, and hat values', () => {
    for (const preset of PRESETS) {
      expect(SPECIES).toContain(preset.species);
      expect(RARITIES).toContain(preset.rarity);
      expect(EYES).toContain(preset.eye);
      expect(HATS).toContain(preset.hat);
    }
  });

  it('should enforce common rarity has no hat', () => {
    const commons = PRESETS.filter((p) => p.rarity === 'common');
    for (const preset of commons) {
      expect(preset.hat).toBe('none');
    }
  });

  it('should have unique names', () => {
    const names = PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should have non-empty descriptions', () => {
    for (const preset of PRESETS) {
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});
