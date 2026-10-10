import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const telegramPath = require.resolve('node-telegram-bot-api');
const openRouterPath = require.resolve('../src/openrouter.js');
const botPath = require.resolve('../src/bot.js');
const askAI = vi.fn();
let instance;

class FakeTelegramBot extends EventEmitter {
  constructor() {
    super();
    instance = this;
    this.outgoing = [];
    this.fileLinkCalls = 0;
    this.failSend = false;
  }

  async getMe() {
    return { id: 999, username: 'bratishka_bot' };
  }

  async startPolling() {}

  async stopPolling() {}

  async getFileLink() {
    this.fileLinkCalls++;
    return 'https://example.com/test-image.jpg';
  }

  async sendMessage(chatId, text, options = {}) {
    if (this.failSend) {
      throw new Error('synthetic Telegram failure');
    }
    const sent = { chatId, text, options };
    this.outgoing.push(sent);
    return sent;
  }
}

require.cache[telegramPath] = {
  id: telegramPath,
  filename: telegramPath,
  loaded: true,
  exports: { TelegramBot: FakeTelegramBot },
};
require.cache[openRouterPath] = {
  id: openRouterPath,
  filename: openRouterPath,
  loaded: true,
  exports: { askAI },
};
delete require.cache[botPath];
const { init } = require('../src/bot.js');
const { addMessage, getRecentMessages } = require('../src/history.js');
const { isRateLimited, resetRateLimit } = require('../src/ratelimit.js');
const { isMentioned } = require('../src/utils.js');
const ready = init();

let nextChatId = 1;
let nextUserId = 100;

function makeMessage(text, options = {}) {
  const command = typeof text === 'string' ? text.match(/^\/[^\s]+/) : null;
  return {
    message_id: nextUserId,
    chat: options.chat || { id: nextChatId++, type: 'supergroup' },
    from: options.from || {
      id: nextUserId++,
      username: `user${nextUserId}`,
      first_name: 'Test User',
      is_bot: false,
    },
    text,
    entities: command ? [{ type: 'bot_command', offset: 0, length: command[0].length }] : [],
    ...options,
  };
}

describe('bot message handling', () => {
  beforeEach(async () => {
    await ready;
    instance.outgoing = [];
    instance.fileLinkCalls = 0;
    instance.failSend = false;
    askAI.mockReset();
    askAI.mockResolvedValue('synthetic answer');
    resetRateLimit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps one user message in history and the AI context after a mention', async () => {
    const msg = makeMessage('@bratishka_bot hello');

    await instance.listeners('message')[0](msg);

    expect(getRecentMessages(msg.chat.id, 10).filter((entry) => entry.role === 'user')).toHaveLength(1);
    expect(askAI.mock.calls[0][0].filter((entry) => entry.role === 'user')).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(askAI.mock.calls[0][1]).toEqual({ webSearch: true });
  });

  it('recognizes replies to the bot and keeps one user message in context', async () => {
    const msg = makeMessage('follow up', {
      reply_to_message: { from: { id: 999 } },
    });

    await instance.listeners('message')[0](msg);

    expect(getRecentMessages(msg.chat.id, 10).filter((entry) => entry.role === 'user')).toHaveLength(1);
    expect(askAI.mock.calls[0][0].filter((entry) => entry.role === 'user')).toEqual([
      { role: 'user', content: 'follow up' },
    ]);
    expect(askAI.mock.calls[0][1]).toEqual({ webSearch: true });
  });

  it('ignores a command addressed to another bot and still handles its own command', async () => {
    const chat = { id: nextChatId++, type: 'supergroup' };
    const msg = makeMessage('/clear@other_bot', { chat });
    addMessage(chat.id, 'user', 'keep this entry', 'alice');

    await instance.listeners('message')[0](msg);

    expect(getRecentMessages(chat.id, 10)).toHaveLength(1);
    expect(instance.outgoing).toHaveLength(0);

    await instance.listeners('message')[0](makeMessage('/clear@BRATISHKA_BOT', { chat }));

    expect(getRecentMessages(chat.id, 10)).toHaveLength(0);
    expect(instance.outgoing).toHaveLength(1);
  });

  it('does not treat an email address as a bot mention', async () => {
    const msg = makeMessage('email@bratishka_bot');

    expect(isMentioned(msg.text, 'bratishka_bot')).toBe(false);
    await instance.listeners('message')[0](msg);

    expect(askAI).not.toHaveBeenCalled();
    expect(instance.outgoing).toHaveLength(0);
  });

  it('splits long answers and sends a fallback for empty answers', async () => {
    askAI.mockResolvedValueOnce('x'.repeat(5000));
    await instance.listeners('message')[0](makeMessage('@bratishka_bot long answer'));

    expect(instance.outgoing.map((entry) => entry.text.length)).toEqual([4096, 904]);

    instance.outgoing = [];
    askAI.mockResolvedValueOnce('  \n ');
    await instance.listeners('message')[0](makeMessage('@bratishka_bot empty answer'));

    expect(instance.outgoing).toHaveLength(1);
    expect(instance.outgoing[0].text).toContain('что-то пошло не так');
  });

  it('catches rejected Telegram sends from the message listener', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    instance.failSend = true;

    await expect(instance.listeners('message')[0](makeMessage('/help'))).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith('Error processing Telegram message:', expect.any(Error));
  });

  it('catches a rejected fallback send after the AI request fails', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    askAI.mockRejectedValue(new Error('synthetic OpenRouter failure'));
    instance.failSend = true;

    await expect(instance.listeners('message')[0](makeMessage('@bratishka_bot hello')))
      .resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith('Error processing Telegram message:', expect.any(Error));
  });

  it('checks the photo rate limit before resolving or downloading the image', async () => {
    const msg = makeMessage(undefined, {
      chat: { id: nextChatId++, type: 'private' },
      photo: [{ file_id: 'synthetic-photo' }],
    });
    expect(isRateLimited(msg)).toBe(false);
    expect(isRateLimited(msg)).toBe(false);

    await instance.listeners('message')[0](msg);

    expect(instance.fileLinkCalls).toBe(0);
    expect(askAI).not.toHaveBeenCalled();
    expect(instance.outgoing[0].text).toContain('Слишком часто');
  });

  it('discards an observer response after the mode is turned off', async () => {
    const chat = { id: nextChatId++, type: 'supergroup' };
    let releaseReply;
    askAI.mockImplementation(() => new Promise((resolve) => { releaseReply = resolve; }));

    await instance.listeners('message')[0](makeMessage('/observer_on', { chat }));
    const pendingObservation = instance.listeners('message')[0](makeMessage('ordinary message', { chat }));

    expect(releaseReply).toBeTypeOf('function');
    await instance.listeners('message')[0](makeMessage('/observer_off', { chat }));
    releaseReply('stale observer response');
    await pendingObservation;

    expect(instance.outgoing.map((entry) => entry.text)).toHaveLength(2);
    expect(instance.outgoing.map((entry) => entry.text).join(' ')).not.toContain('stale observer response');
  });
});
