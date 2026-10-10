const fs = require('fs');
const path = require('path');
const config = require('./config');
const { formatContentForHistory } = require('./utils');

const HISTORY_FILE = path.join(config.dataDirectory, 'history.json');

/** @type {Map<number, Array<{role: string, content: string, username: string, timestamp: number}>>} */
const histories = new Map();
let saveTimeout = null;
let writer = null;
let dirty = false;
const TEMP_HISTORY_FILE = `${HISTORY_FILE}.${process.pid}.tmp`;

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));

    if (data && typeof data === 'object') {
      for (const [chatIdStr, messages] of Object.entries(data)) {
        if (Array.isArray(messages)) {
          histories.set(Number(chatIdStr), messages);
        }
      }
    }

    console.log(`Loaded history for ${histories.size} chat(s) from ${HISTORY_FILE}`);
  } catch (error) {
    console.error('Failed to load history file:', error);
  }
}

function scheduleSaveHistory() {
  if (saveTimeout || writer) {
    return;
  }

  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    flushHistory().catch((error) => {
      console.error('Failed to save history file:', error);
    });
  }, config.historySaveIntervalMs);
}

function flushHistory() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (writer) {
    return writer;
  }
  if (!dirty) {
    return Promise.resolve();
  }

  writer = Promise.resolve().then(async () => {
    try {
      while (dirty) {
        dirty = false;
        const snapshot = JSON.stringify(Object.fromEntries(histories), null, 2);
        await fs.promises.writeFile(TEMP_HISTORY_FILE, snapshot);
        await fs.promises.rename(TEMP_HISTORY_FILE, HISTORY_FILE);
      }
    } catch (error) {
      dirty = true;
      try {
        await fs.promises.unlink(TEMP_HISTORY_FILE);
      } catch {
        // Preserve the publication error even when temporary-file cleanup fails.
      }
      throw error;
    } finally {
      writer = null;
      if (dirty) scheduleSaveHistory();
    }
  });
  return writer;
}

/**
 * Дожидается публикации всей текущей истории, включая изменения во время записи.
 * @returns {Promise<void>}
 */
async function saveHistorySync() {
  await flushHistory();
}

/**
 * Добавляет сообщение в историю чата.
 * @param {number} chatId
 * @param {'user' | 'assistant' | 'system'} role
 * @param {string | Array<{type: string, text?: string, image_url?: {url: string}}>} content
 * @param {string} [username]
 */
function addMessage(chatId, role, content, username = '') {
  if (!histories.has(chatId)) {
    histories.set(chatId, []);
  }

  const history = histories.get(chatId);
  history.push({
    role,
    content: formatContentForHistory(content),
    username: role === 'assistant' ? '' : username,
    timestamp: Date.now(),
  });

  if (history.length > config.maxHistory) {
    history.shift();
  }

  dirty = true;
  scheduleSaveHistory();
}

/**
 * Возвращает последние сообщения в формате, подходящем для OpenRouter API.
 * @param {number} chatId
 * @param {number} [limit=10]
 * @returns {Array<{role: string, content: string}>}
 */
function getRecentMessages(chatId, limit = 10) {
  const history = histories.get(chatId) || [];
  return history.slice(-limit).map((message) => ({
    role: message.role,
    content: message.username ? `${message.username}: ${message.content}` : message.content,
  }));
}

/**
 * Возвращает последние сообщения конкретного пользователя в формате, подходящем для OpenRouter API.
 * Сравнение по username нечувствительно к регистру и символу @ в начале.
 * @param {number} chatId
 * @param {string} username
 * @param {number} [limit=10]
 * @returns {Array<{role: string, content: string}>}
 */
function getMessagesByUser(chatId, username, limit = 10) {
  if (!username) {
    return [];
  }

  const normalizedTarget = username.replace(/^@/, '').toLowerCase();
  const history = histories.get(chatId) || [];

  return history
    .filter((message) => {
      if (!message.username) {
        return false;
      }
      const normalizedSource = message.username.replace(/^@/, '').toLowerCase();
      return normalizedSource === normalizedTarget;
    })
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      content: `${message.username}: ${message.content}`,
    }));
}

/**
 * Очищает историю сообщений для чата.
 * @param {number} chatId
 */
function clearHistory(chatId) {
  histories.delete(chatId);
  dirty = true;
  scheduleSaveHistory();
}

loadHistory();

module.exports = { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync };
