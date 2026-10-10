import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../src/config.js');
let telegram;
class FakeTelegram extends EventEmitter {
  constructor() {
    super();
    telegram = this;
    this.outgoing = [];
  }
  async getMe() { return { id: 999, username: 'bratishka_bot' }; }
  async startPolling() {}
  async stopPolling() {}
  async sendMessage(chatId, text, options) { this.outgoing.push({ chatId, text, options }); }
}
const telegramPath = require.resolve('node-telegram-bot-api');
require.cache[telegramPath] = { id: telegramPath, filename: telegramPath, loaded: true, exports: { TelegramBot: FakeTelegram } };
delete require.cache[require.resolve('../src/openrouter.js')];
delete require.cache[require.resolve('../src/bot.js')];
const { init } = require('../src/bot.js');
const { getRecentMessages } = require('../src/history.js');
const ready = init();
let nextId = 5000;
const makeMessage = (text, extra = {}) => ({
  message_id: nextId,
  chat: { id: nextId++, type: 'supergroup' },
  from: { id: nextId++, first_name: 'User' },
  text,
  ...extra,
});
const completion = (message) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });

describe('automatic search through Telegram message handling', () => {
  beforeEach(async () => {
    await ready;
    config.tavilyApiKey = 'test-search-key';
    telegram.outgoing = [];
  });
  afterEach(() => {
    config.tavilyApiKey = '';
    vi.unstubAllGlobals();
  });

  it.each(['mention', 'reply'])('sends a sourced answer after a %s without a search command', async (trigger) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({
        role: 'assistant', content: null,
        tool_calls: [{ id: 'search', type: 'function', function: { name: 'search_web', arguments: '{"query":"latest release"}' } }],
      }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ title: 'Release', url: 'https://example.org/release', content: 'A release was announced today.' }] }) })
      .mockResolvedValueOnce(completion({ content: 'Сегодня вышла новая версия [1].' }));
    vi.stubGlobal('fetch', fetchMock);
    const msg = trigger === 'mention'
      ? makeMessage('@bratishka_bot какая версия вышла сегодня?')
      : makeMessage('какая версия вышла сегодня?', { reply_to_message: { from: { id: 999 } } });
    await telegram.listeners('message')[0](msg);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(telegram.outgoing).toHaveLength(1);
    expect(telegram.outgoing[0]).toMatchObject({
      chatId: msg.chat.id,
      options: { reply_to_message_id: msg.message_id },
      text: 'Сегодня вышла новая версия [1].\n\nИсточники:\n[1] Release\nhttps://example.org/release',
    });
    const history = getRecentMessages(msg.chat.id, 10);
    expect(history.map((entry) => entry.role)).toEqual(['user', 'assistant']);
    expect(history[1].content).toContain('https://example.org/release');
  });

  it('does not contact AI or search for an ordinary group message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await telegram.listeners('message')[0](makeMessage('какая версия вышла сегодня?'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(telegram.outgoing).toHaveLength(0);
  });

  it('keeps automatic observer analysis free of search tools', async () => {
    const msg = makeMessage('/observer_on');
    await telegram.listeners('message')[0](msg);
    const fetchMock = vi.fn().mockResolvedValue(completion({ content: 'SKIP' }));
    vi.stubGlobal('fetch', fetchMock);
    await telegram.listeners('message')[0](makeMessage('сегодня новая версия?', { chat: msg.chat }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('tools');
    expect(telegram.outgoing).toHaveLength(1);
  });
});
