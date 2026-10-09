import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.env.BOT_DATA_DIR, 'observer-state.json');

function resetStateFile() {
  fs.writeFileSync(STATE_FILE, '{}');
}

import { loadState, isObserverEnabled, getObserverGeneration, setObserver, shouldObserve } from '../src/observer.js';

describe('observer', () => {
  beforeEach(() => {
    resetStateFile();
    loadState();
  });

  afterEach(() => {
    resetStateFile();
  });

  it('is disabled by default', () => {
    expect(isObserverEnabled(1)).toBe(false);
  });

  it('can be enabled and disabled', () => {
    setObserver(1, true);
    expect(isObserverEnabled(1)).toBe(true);
    setObserver(1, false);
    expect(isObserverEnabled(1)).toBe(false);
  });

  it('changes the observer generation when its state changes', () => {
    setObserver(1, true);
    const enabledGeneration = getObserverGeneration(1);

    setObserver(1, true);
    expect(getObserverGeneration(1)).toBe(enabledGeneration);

    setObserver(1, false);

    expect(getObserverGeneration(1)).toBe(enabledGeneration + 1);
  });

  it('triggers observer after interval messages', () => {
    setObserver(1, true);
    expect(shouldObserve(1, 3)).toBe(false);
    expect(shouldObserve(1, 3)).toBe(false);
    expect(shouldObserve(1, 3)).toBe(true);
  });

  it('respects minimum interval between observations', () => {
    setObserver(1, true);
    expect(shouldObserve(1, 2)).toBe(false);
    expect(shouldObserve(1, 2)).toBe(true);
    expect(shouldObserve(1, 2)).toBe(false);
  });
});
