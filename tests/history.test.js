import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    writeFile: vi.fn(() => Promise.resolve()),
  },
}));

import { addMessage, getRecentMessages, clearHistory, saveHistorySync } from '../src/history.js';

describe('history', () => {
  beforeEach(() => {
    clearHistory(1);
  });

  afterEach(() => {
    clearHistory(1);
  });

  it('adds user and assistant messages', () => {
    addMessage(1, 'user', 'hello', 'user1');
    addMessage(1, 'assistant', 'hi there');
    const recent = getRecentMessages(1, 10);
    expect(recent).toHaveLength(2);
    expect(recent[0]).toEqual({ role: 'user', content: 'user1: hello' });
    expect(recent[1]).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('limits history size', () => {
    for (let i = 0; i < 10; i++) {
      addMessage(1, 'user', `msg${i}`, 'u');
    }
    expect(getRecentMessages(1, 100)).toHaveLength(5);
  });

  it('returns recent messages limited by parameter', () => {
    addMessage(1, 'user', 'a', 'u');
    addMessage(1, 'user', 'b', 'u');
    addMessage(1, 'user', 'c', 'u');
    expect(getRecentMessages(1, 2)).toHaveLength(2);
  });

  it('clears history', () => {
    addMessage(1, 'user', 'hello', 'u');
    clearHistory(1);
    expect(getRecentMessages(1, 10)).toHaveLength(0);
  });

  it('saves history synchronously', async () => {
    addMessage(1, 'user', 'hello', 'u');
    await saveHistorySync();
  });
});
