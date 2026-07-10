require('dotenv').config();

const required = ['TELEGRAM_BOT_TOKEN', 'OPENROUTER_API_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

function parseIntEnv(value, defaultValue) {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

module.exports = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openRouterRequestTimeout: parseIntEnv(process.env.OPENROUTER_REQUEST_TIMEOUT, 30000),
  observerInterval: parseIntEnv(process.env.OBSERVER_INTERVAL, 10),
  observerContextLimit: parseIntEnv(process.env.OBSERVER_CONTEXT_LIMIT, 10),
  observerMinIntervalMs: parseIntEnv(process.env.OBSERVER_MIN_INTERVAL_MS, 30000),
  maxHistory: parseIntEnv(process.env.MAX_HISTORY, 200),
  historyContextLimit: parseIntEnv(process.env.HISTORY_CONTEXT_LIMIT, 30),
  historySaveIntervalMs: parseIntEnv(process.env.HISTORY_SAVE_INTERVAL_MS, 5000),
  botUsername: process.env.BOT_USERNAME ? process.env.BOT_USERNAME.replace(/^@/, '') : null,
  botPersonality: (process.env.BOT_PERSONALITY || 'bratishka').toLowerCase(),
  openRouterReferer: process.env.OPENROUTER_REFERER || '',
  debug: process.env.DEBUG === 'true',
  rateLimitWindowMs: parseIntEnv(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMaxRequests: parseIntEnv(process.env.RATE_LIMIT_MAX_REQUESTS, 10),
  maxMessageLength: parseIntEnv(process.env.MAX_MESSAGE_LENGTH, 4096),
  openRouterMaxTokens: parseIntEnv(process.env.OPENROUTER_MAX_TOKENS, 4096),
  visionMaxImageSize: parseIntEnv(process.env.VISION_MAX_IMAGE_SIZE, 1024),
  visionJpegQuality: parseIntEnv(process.env.VISION_JPEG_QUALITY, 80),
};
