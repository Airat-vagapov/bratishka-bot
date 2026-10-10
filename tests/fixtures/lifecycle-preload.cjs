const { EventEmitter } = require('node:events');
const path = require('node:path');

let bot;
let releaseSend;
let releaseIdentity;

function notify(message) {
  if (process.connected) process.send(message);
}

class FakeTelegramBot extends EventEmitter {
  constructor() {
    super();
    bot = this;
  }

  async getMe() {
    notify({ type: 'identity-started' });
    if (process.env.LIFECYCLE_DEFER_IDENTITY === 'true') {
      await new Promise((resolve) => { releaseIdentity = resolve; });
    }
    if (process.env.LIFECYCLE_FAIL_IDENTITY === 'true') {
      throw new Error('synthetic identity failure');
    }
    return { id: 999, username: 'test_bot' };
  }

  async startPolling() {
    if (process.env.LIFECYCLE_FAIL_POLLING === 'true') {
      throw new Error('synthetic polling failure');
    }
    notify({ type: 'polling-started' });
  }

  async stopPolling(options) {
    notify({ type: 'polling-stopped', cancel: options?.cancel });
  }

  async sendMessage(chatId, text) {
    notify({ type: 'send-started', chatId, text });
    if (process.env.LIFECYCLE_DEFER_SEND === 'true') {
      await new Promise((resolve) => { releaseSend = resolve; });
    }
    return { chatId, text };
  }
}

const telegramPath = require.resolve('node-telegram-bot-api');
require.cache[telegramPath] = {
  id: telegramPath,
  filename: telegramPath,
  loaded: true,
  exports: { TelegramBot: FakeTelegramBot },
};

const openRouterPath = path.join(process.cwd(), 'src/openrouter.js');
require.cache[openRouterPath] = {
  id: openRouterPath,
  filename: openRouterPath,
  loaded: true,
  exports: { askAI: async () => 'synthetic answer' },
};

process.on('message', (message) => {
  if (message?.type === 'inject-message') {
    bot.emit('message', {
      message_id: 101,
      chat: { id: 42, type: 'private' },
      from: { id: 7, username: 'alice', is_bot: false },
      text: '@test_bot hello',
    });
  } else if (message?.type === 'release-send') {
    releaseSend?.();
  } else if (message?.type === 'release-identity') {
    releaseIdentity?.();
  }
});
