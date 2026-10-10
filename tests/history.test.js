import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const path = require('node:path');
const { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync } = require('../src/history.js');
const target = path.join(process.env.BOT_DATA_DIR, 'history.json');
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('history', () => {
  beforeEach(async () => {
    clearHistory(1);
    clearHistory(2);
    await saveHistorySync();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    clearHistory(1);
    clearHistory(2);
    await saveHistorySync();
    vi.useRealTimers();
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
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))[1]).toEqual([
      { role: 'user', content: 'hello', username: 'u', timestamp: expect.any(Number) },
    ]);
  });

  it.each(['write', 'rename'])('joins both callers through mutations during %s', async (phase) => {
    vi.useFakeTimers();
    const gate = deferred();
    const latest = deferred();
    let active = 0;
    let maxActive = 0;
    let writes = 0;
    let renames = 0;
    const snapshots = [];
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (_file, data) => {
      maxActive = Math.max(maxActive, ++active);
      snapshots.push(JSON.parse(data));
      if (++writes === 1 && phase === 'write') await gate.promise;
    });
    vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
      if (++renames === 1 && phase === 'rename') await gate.promise;
      if (renames === 2) await latest.promise;
      active--;
    });
    addMessage(1, 'user', 'stale', 'u');
    let settled = 0;
    const first = saveHistorySync().then(() => { settled++; });
    await tick();
    clearHistory(1);
    addMessage(2, 'assistant', 'latest');
    const second = saveHistorySync().then(() => { settled++; });
    await tick();
    const beforeRelease = settled;
    gate.resolve();
    await tick();
    const beforeLatestPublish = settled;
    latest.resolve();
    await Promise.all([first, second]);
    expect(beforeRelease).toBe(0);
    expect(beforeLatestPublish).toBe(0);
    expect(maxActive).toBe(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1][1]).toBeUndefined();
    expect(snapshots[1][2][0].content).toBe('latest');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['writeFile', 'rename'])('preserves old bytes and retries after %s failure', async (method) => {
    const old = fs.readFileSync(target, 'utf8');
    const failure = new Error(`${method} failure`);
    const spy = vi.spyOn(fs.promises, method).mockRejectedValueOnce(failure);
    const cleanup = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('cleanup failure'));
    addMessage(1, 'user', 'retry me', 'u');
    const result = await saveHistorySync().then(() => null, (error) => error);
    expect(spy).toHaveBeenCalledOnce();
    expect(result).toBe(failure);
    expect(fs.readFileSync(target, 'utf8')).toBe(old);
    expect(cleanup).toHaveBeenCalledOnce();
    spy.mockRestore();
    cleanup.mockRestore();
    await saveHistorySync();
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))[1][0].content).toBe('retry me');
  });

  it('joins a failed background writer and delays its retry without overlap', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const failure = new Error('background failure');
    const realWrite = fs.promises.writeFile;
    const write = vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async () => {
      await gate.promise;
      throw failure;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    addMessage(1, 'user', 'latest', 'u');
    await vi.advanceTimersByTimeAsync(1);
    const joined = saveHistorySync().then(() => null, (error) => error);
    addMessage(2, 'assistant', 'overlap');
    await vi.advanceTimersByTimeAsync(10);
    const writesWhileBlocked = write.mock.calls.length;
    gate.resolve();
    const error = await joined;
    await tick();
    expect(writesWhileBlocked).toBe(1);
    expect(error).toBe(failure);
    expect(console.error).toHaveBeenCalledWith('Failed to save history file:', failure);
    expect(vi.getTimerCount()).toBe(1);
    const retryGate = deferred();
    write.mockImplementationOnce(async (...args) => {
      await retryGate.promise;
      return realWrite(...args);
    });
    await vi.advanceTimersByTimeAsync(1);
    addMessage(1, 'user', 'during retry', 'u');
    const flush = saveHistorySync();
    await vi.advanceTimersByTimeAsync(10);
    expect(write).toHaveBeenCalledTimes(2);
    retryGate.resolve();
    await flush;
    expect(write).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))[1].at(-1).content).toBe('during retry');
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
