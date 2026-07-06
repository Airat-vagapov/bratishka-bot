const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'observer-state.json');

/** @type {Object.<number, boolean>} */
let observerState = {};
/** @type {Map<number, number>} */
const messageCounters = new Map();

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      observerState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (error) {
      console.error('Failed to load observer state:', error);
      observerState = {};
    }
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(observerState, null, 2));
}

/**
 * Включён ли режим активного наблюдателя для чата.
 * @param {number} chatId
 * @returns {boolean}
 */
function isObserverEnabled(chatId) {
  return !!observerState[chatId];
}

/**
 * Включает или выключает режим активного наблюдателя для чата.
 * @param {number} chatId
 * @param {boolean} enabled
 */
function setObserver(chatId, enabled) {
  observerState[chatId] = enabled;
  saveState();
}

/**
 * Увеличивает счётчик сообщений чата и проверяет, пора ли анализировать диалог.
 * @param {number} chatId
 * @param {number} interval
 * @returns {boolean}
 */
function shouldObserve(chatId, interval) {
  const count = (messageCounters.get(chatId) || 0) + 1;
  messageCounters.set(chatId, count);

  if (count >= interval) {
    messageCounters.set(chatId, 0);
    return true;
  }

  return false;
}

module.exports = { loadState, isObserverEnabled, setObserver, shouldObserve };
