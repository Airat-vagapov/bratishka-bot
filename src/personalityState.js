const fs = require('fs');
const path = require('path');
const config = require('./config');
const { isValidPersonality } = require('./personalities');

const STATE_FILE = path.join(__dirname, '..', 'personality-state.json');

/**
 * @typedef {Object} ChatPersonalityState
 * @property {string} personality
 */

/** @type {Object.<number, ChatPersonalityState>} */
let personalityState = {};

function loadState() {
  personalityState = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (data && typeof data === 'object') {
        personalityState = data;
      }
    } catch (error) {
      console.error('Failed to load personality state:', error);
    }
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(personalityState, null, 2));
  } catch (error) {
    console.error('Failed to save personality state:', error);
  }
}

function getChatState(chatId) {
  if (!personalityState[chatId]) {
    personalityState[chatId] = { personality: config.botPersonality };
  }
  return personalityState[chatId];
}

/**
 * Возвращает текущую личность чата.
 * @param {number} chatId
 * @returns {string}
 */
function getChatPersonality(chatId) {
  const state = getChatState(chatId);
  if (!isValidPersonality(state.personality)) {
    state.personality = config.botPersonality;
    saveState();
  }
  return state.personality;
}

/**
 * Устанавливает личность для чата.
 * @param {number} chatId
 * @param {string} personality
 * @returns {boolean}
 */
function setChatPersonality(chatId, personality) {
  if (!isValidPersonality(personality)) {
    return false;
  }
  const state = getChatState(chatId);
  state.personality = personality.toLowerCase();
  saveState();
  return true;
}

module.exports = {
  loadState,
  getChatPersonality,
  setChatPersonality,
};
