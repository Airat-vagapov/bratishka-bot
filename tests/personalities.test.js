import { describe, it, expect } from 'vitest';
import { getPersonality, listPersonalities, isValidPersonality, DEFAULT_PERSONALITY } from '../src/personalities.js';

describe('personalities', () => {
  it('returns default personality for unknown name', () => {
    const personality = getPersonality('nonexistent');
    expect(personality.name).toBe(DEFAULT_PERSONALITY);
  });

  it('returns requested personality case-insensitively', () => {
    const personality = getPersonality('GAMER');
    expect(personality.name).toBe('gamer');
    expect(personality.basePrompt).toBeTruthy();
  });

  it('lists all personalities', () => {
    const list = listPersonalities();
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((p) => p.name).sort()).toEqual(['bratishka', 'dagestan', 'gamer']);
  });

  it('validates existing personalities', () => {
    expect(isValidPersonality('bratishka')).toBe(true);
    expect(isValidPersonality('dagestan')).toBe(true);
    expect(isValidPersonality('BRATISHKA')).toBe(true);
    expect(isValidPersonality('unknown')).toBe(false);
    expect(isValidPersonality('')).toBe(false);
  });
});
