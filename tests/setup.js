const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `bratishka-bot-tests-${process.pid}-`));

process.env.BOT_DATA_DIR = testDataDirectory;
afterAll(async () => {
  const history = require.cache[require.resolve('../src/history.js')];
  if (history) await history.exports.saveHistorySync();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_MODEL = 'openai/gpt-4o-mini';
process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
process.env.OPENROUTER_REQUEST_TIMEOUT = '30000';
process.env.OPENROUTER_MAX_TOKENS = '4096';
process.env.MAX_HISTORY = '5';
process.env.HISTORY_CONTEXT_LIMIT = '3';
process.env.HISTORY_SAVE_INTERVAL_MS = '1';
process.env.OBSERVER_MIN_INTERVAL_MS = '1000';
process.env.OBSERVER_INTERVAL = '1';
process.env.RATE_LIMIT_WINDOW_MS = '1000';
process.env.RATE_LIMIT_MAX_REQUESTS = '2';
