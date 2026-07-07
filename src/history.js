const fs = require('fs');
const path = require('path');
const config = require('./config');

const HISTORY_FILE = path.join(__dirname, '..', 'history.json');

/** @type {Map<number, Array<{role: string, content: string, username: string, timestamp: number}>>} */
const histories = new Map();

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

function saveHistory() {
  try {
    const data = Object.fromEntries(histories);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save history file:', error);
  }
}

/**
 * Добавляет сообщение в историю чата.
 * @param {number} chatId
 * @param {'user' | 'assistant' | 'system'} role
 * @param {string} text
 * @param {string} [username]
 */
function addMessage(chatId, role, text, username = '') {
  if (!histories.has(chatId)) {
    histories.set(chatId, []);
  }

  const history = histories.get(chatId);
  history.push({ role, content: text, username, timestamp: Date.now() });

  if (history.length > config.maxHistory) {
    history.shift();
  }

  saveHistory();
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
 * Очищает историю сообщений для чата.
 * @param {number} chatId
 */
function clearHistory(chatId) {
  histories.delete(chatId);
  saveHistory();
}

loadHistory();

module.exports = { addMessage, getRecentMessages, clearHistory };
