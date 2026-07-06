const config = require('./config');

/** @type {Map<number, Array<{role: string, content: string, username: string, timestamp: number}>>} */
const histories = new Map();

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
}

module.exports = { addMessage, getRecentMessages, clearHistory };
