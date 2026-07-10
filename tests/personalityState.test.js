import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'personality-state.json');

function resetStateFile() {
  fs.writeFileSync(STATE_FILE, '{}');
}

import { loadState, getChatPersonality, setChatPersonality } from '../src/personalityState.js';

describe('personalityState', () => {
  beforeEach(() => {
    resetStateFile();
    loadState();
  });

  afterEach(() => {
    resetStateFile();
  });

  it('returns default personality for new chat', () => {
    expect(getChatPersonality(1)).toBe('bratishka');
  });

  it('sets and returns chat personality', () => {
    expect(setChatPersonality(1, 'gamer')).toBe(true);
    expect(getChatPersonality(1)).toBe('gamer');
  });

  it('rejects invalid personality', () => {
    expect(setChatPersonality(1, 'unknown')).toBe(false);
    expect(getChatPersonality(1)).toBe('bratishka');
  });

  it('persists personality across loadState', () => {
    setChatPersonality(1, 'dagestan');
    loadState();
    expect(getChatPersonality(1)).toBe('dagestan');
  });
});
