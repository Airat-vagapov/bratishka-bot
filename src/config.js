require('dotenv').config();

const required = ['TELEGRAM_BOT_TOKEN', 'OPENROUTER_API_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  observerInterval: parseInt(process.env.OBSERVER_INTERVAL || '10', 10),
  maxHistory: parseInt(process.env.MAX_HISTORY || '200', 10),
  historyContextLimit: parseInt(process.env.HISTORY_CONTEXT_LIMIT || '30', 10),
  botUsername: process.env.BOT_USERNAME ? process.env.BOT_USERNAME.replace(/^@/, '') : null,
  openRouterReferer: process.env.OPENROUTER_REFERER || '',
  debug: process.env.DEBUG === 'true',
};
