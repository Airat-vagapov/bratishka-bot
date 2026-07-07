const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(__dirname, '..', 'observer-state.json');

/**
 * @typedef {Object} ChatObserverState
 * @property {boolean} enabled
 * @property {number} messageCount
 * @property {number} [lastObservationAt]
 */

/** @type {Object.<number, ChatObserverState>} */
let observerState = {};

function loadState() {
  observerState = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (data && typeof data === 'object') {
        observerState = data;
      }
    } catch (error) {
      console.error('Failed to load observer state:', error);
    }
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(observerState, null, 2));
  } catch (error) {
    console.error('Failed to save observer state:', error);
  }
}

function getChatState(chatId) {
  if (!observerState[chatId]) {
    observerState[chatId] = { enabled: false, messageCount: 0 };
  }
  return observerState[chatId];
}

/**
 * Включён ли режим активного наблюдателя для чата.
 * @param {number} chatId
 * @returns {boolean}
 */
function isObserverEnabled(chatId) {
  return !!getChatState(chatId).enabled;
}

/**
 * Включает или выключает режим активного наблюдателя для чата.
 * @param {number} chatId
 * @param {boolean} enabled
 */
function setObserver(chatId, enabled) {
  const state = getChatState(chatId);
  state.enabled = enabled;
  if (!enabled) {
    state.messageCount = 0;
  }
  saveState();
}

/**
 * Увеличивает счётчик сообщений чата и проверяет, пора ли анализировать диалог.
 * Учитывает минимальный интервал между observer-запросами.
 * @param {number} chatId
 * @param {number} interval
 * @returns {boolean}
 */
function shouldObserve(chatId, interval) {
  const state = getChatState(chatId);
  state.messageCount = (state.messageCount || 0) + 1;

  if (state.messageCount < interval) {
    saveState();
    return false;
  }

  const now = Date.now();
  if (state.lastObservationAt && now - state.lastObservationAt < config.observerMinIntervalMs) {
    return false;
  }

  state.messageCount = 0;
  state.lastObservationAt = now;
  saveState();
  return true;
}

module.exports = { loadState, isObserverEnabled, setObserver, shouldObserve };
