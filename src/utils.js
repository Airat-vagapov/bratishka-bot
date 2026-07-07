const config = require('./config');

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionRegex(username) {
  if (!username) {
    return null;
  }
  return new RegExp(`(?<!\\w)@${escapeRegExp(username)}\\b`, 'gi');
}

function isMentioned(text, username) {
  if (!username || !text) {
    return false;
  }
  const regex = buildMentionRegex(username);
  regex.lastIndex = 0;
  return regex.test(text);
}

function removeMention(text, username) {
  if (!username || !text) {
    return text ? text.trim() : '';
  }
  return text.replace(buildMentionRegex(username), '').trim();
}

function isReplyToBot(replyMessage, botUserId) {
  if (!replyMessage || !replyMessage.from || botUserId === null || botUserId === undefined) {
    return false;
  }
  return Number(replyMessage.from.id) === Number(botUserId);
}

function truncateMessage(text, maxLength = config.maxMessageLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

function sanitizeUsername(username) {
  if (!username) {
    return '';
  }
  return username.replace(/[\n\r]/g, '').slice(0, 64);
}

module.exports = {
  escapeRegExp,
  buildMentionRegex,
  isMentioned,
  removeMention,
  isReplyToBot,
  truncateMessage,
  sanitizeUsername,
};
