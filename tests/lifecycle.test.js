import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const paths = ['node-telegram-bot-api', '../src/openrouter.js', '../src/history.js', '../src/bot.js']
  .map((name) => require.resolve(name));
let originals;
let bot;
let lifecycle;
let history;
let askAI;
let signals;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function tick() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

function message(text = '@bratishka_bot hello') {
  return { message_id: 1, chat: { id: 987, type: 'supergroup' }, from: { id: 654, username: 'alice' }, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => {});
  originals = paths.map((path) => require.cache[path]);
  signals = ['SIGINT', 'SIGTERM'].map((signal) => process.listeners(signal));
  history = {
    addMessage: vi.fn(), getRecentMessages: vi.fn(() => []), getMessagesByUser: vi.fn(() => []),
    clearHistory: vi.fn(), saveHistorySync: vi.fn(async () => {}),
  };
  askAI = vi.fn(async () => 'answer');
  class FakeTelegram extends EventEmitter {
    constructor() {
      super();
      bot = this;
      this.getMe = vi.fn(async () => ({ id: 999, username: 'bratishka_bot' }));
      this.startPolling = vi.fn(async () => {});
      this.stopPolling = vi.fn(async () => {});
      this.sendMessage = vi.fn(async () => {});
    }
  }
  [{ TelegramBot: FakeTelegram }, { askAI }, history].forEach((exports, index) => {
    require.cache[paths[index]] = { id: paths[index], filename: paths[index], loaded: true, exports };
  });
  delete require.cache[paths[3]];
  lifecycle = require('../src/bot.js');
  require('../src/ratelimit.js').resetRateLimit();
});

afterEach(() => {
  ['SIGINT', 'SIGTERM'].forEach((signal, index) => {
    for (const listener of process.listeners(signal)) {
      if (!signals[index].includes(listener)) process.removeListener(signal, listener);
    }
  });
  paths.forEach((path, index) => {
    if (originals[index]) require.cache[path] = originals[index];
    else delete require.cache[path];
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded bot lifecycle', () => {
  it('drains admitted AI and send, closes admission, then joins a deferred final flush', async () => {
    await lifecycle.init();
    const ai = deferred();
    const send = deferred();
    const flush = deferred();
    askAI.mockReturnValue(ai.promise);
    bot.sendMessage.mockReturnValue(send.promise);
    history.saveHistorySync.mockReturnValue(flush.promise);
    const handled = bot.listeners('message')[0](message());
    await tick();
    const stopping = lifecycle.shutdown();
    expect(lifecycle.shutdown()).toBe(stopping);
    await bot.listeners('message')[0](message('late message'));
    await tick();
    expect(history.saveHistorySync).not.toHaveBeenCalled();
    expect(history.addMessage).toHaveBeenCalledTimes(1);
    expect(bot.stopPolling).toHaveBeenCalledWith({ cancel: true });
    ai.resolve('completed answer');
    await tick();
    expect(history.saveHistorySync).not.toHaveBeenCalled();
    send.resolve();
    await handled;
    await tick();
    expect(history.addMessage).toHaveBeenLastCalledWith(987, 'assistant', 'completed answer');
    expect(history.saveHistorySync).toHaveBeenCalledTimes(1);
    let complete = false;
    stopping.then(() => { complete = true; });
    await tick();
    expect(complete).toBe(false);
    flush.resolve();
    await stopping;
    expect(process.exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues draining an admitted handler when polling cancellation rejects', async () => {
    await lifecycle.init();
    const ai = deferred();
    askAI.mockReturnValue(ai.promise);
    bot.stopPolling.mockRejectedValue(new Error('stop failed'));
    const handled = bot.listeners('message')[0](message());
    await tick();
    const outcome = lifecycle.shutdown().catch((error) => error);
    await tick();
    expect(history.saveHistorySync).not.toHaveBeenCalled();
    ai.resolve('surviving answer');
    await handled;
    expect(await outcome).toBeInstanceOf(Error);
    expect(history.addMessage).toHaveBeenLastCalledWith(987, 'assistant', 'surviving answer');
    expect(history.saveHistorySync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start polling after getMe completes during shutdown', async () => {
    const me = deferred();
    bot.getMe.mockReturnValue(me.promise);
    const starting = lifecycle.init();
    await tick();
    const stopping = lifecycle.shutdown();
    await tick();
    expect(bot.startPolling).not.toHaveBeenCalled();
    me.resolve({ id: 999, username: 'bratishka_bot' });
    await Promise.all([starting, stopping]);
    expect(bot.startPolling).not.toHaveBeenCalled();
  });

  it.each(['stop', 'handler'])('bounds a hung %s, attempts flush and observes late rejection', async (phase) => {
    await lifecycle.init();
    const pending = deferred();
    if (phase === 'stop') bot.stopPolling.mockReturnValue(pending.promise);
    else {
      bot.sendMessage.mockReturnValue(pending.promise);
      bot.listeners('message')[0](message('/help'));
    }
    const outcome = lifecycle.shutdown().catch((error) => error);
    await vi.advanceTimersByTimeAsync(39999);
    expect(history.saveHistorySync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(Error);
    expect(history.saveHistorySync).toHaveBeenCalledTimes(1);
    pending.reject(new Error('late rejection'));
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reserves a separate 5 second flush budget after the 40 second drain deadline', async () => {
    bot.stopPolling.mockReturnValue(new Promise(() => {}));
    const flush = deferred();
    history.saveHistorySync.mockReturnValue(flush.promise);
    let complete = false;
    const outcome = lifecycle.shutdown().catch((error) => { complete = true; return error; });
    await vi.advanceTimersByTimeAsync(40000);
    expect(history.saveHistorySync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(Error);
    flush.reject(new Error('late write failure'));
    await tick();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a flush failure and leaves exit policy to the entrypoint', async () => {
    history.saveHistorySync.mockRejectedValue(new Error('disk failed'));
    const outcome = await lifecycle.shutdown().catch((error) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(process.exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
