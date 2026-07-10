import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    writeFile: vi.fn(() => Promise.resolve()),
  },
}));

import { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync } from '../src/history.js';

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

  it('stores image content as [image] placeholder', () => {
    addMessage(1, 'user', [
      { type: 'text', text: 'Что на фото?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } },
    ], 'u');
    const recent = getRecentMessages(1, 10);
    expect(recent[0]).toEqual({ role: 'user', content: 'u: [image] Что на фото?' });
  });

  it('saves history synchronously', async () => {
    addMessage(1, 'user', 'hello', 'u');
    await saveHistorySync();
  });

  describe('getMessagesByUser', () => {
    it('returns messages for a specific user', () => {
      addMessage(1, 'user', 'hello', 'alice');
      addMessage(1, 'user', 'hi', 'bob');
      addMessage(1, 'user', 'world', 'alice');

      const messages = getMessagesByUser(1, 'alice', 10);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'alice: hello' });
      expect(messages[1]).toEqual({ role: 'user', content: 'alice: world' });
    });

    it('ignores leading @ in username', () => {
      addMessage(1, 'user', 'hello', 'alice');
      const messages = getMessagesByUser(1, '@alice', 10);
      expect(messages).toHaveLength(1);
    });

    it('is case-insensitive', () => {
      addMessage(1, 'user', 'hello', 'Alice');
      const messages = getMessagesByUser(1, 'ALICE', 10);
      expect(messages).toHaveLength(1);
    });

    it('limits messages by parameter', () => {
      addMessage(1, 'user', 'a', 'alice');
      addMessage(1, 'user', 'b', 'alice');
      addMessage(1, 'user', 'c', 'alice');

      const messages = getMessagesByUser(1, 'alice', 2);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'alice: b' });
      expect(messages[1]).toEqual({ role: 'user', content: 'alice: c' });
    });

    it('returns empty array if user has no messages', () => {
      addMessage(1, 'user', 'hello', 'bob');
      expect(getMessagesByUser(1, 'alice', 10)).toHaveLength(0);
    });

    it('returns empty array for empty username', () => {
      addMessage(1, 'user', 'hello', 'alice');
      expect(getMessagesByUser(1, '', 10)).toHaveLength(0);
    });
  });
});
