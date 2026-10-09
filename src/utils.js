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
  const safeMaxLength = Math.max(1, Math.min(maxLength, 4096));
  let end = safeMaxLength - 1;
  if (end > 0 && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
    end--;
  }
  return `${text.slice(0, end)}…`;
}

function splitMessage(text, maxLength = config.maxMessageLength) {
  if (!text.trim()) {
    return [];
  }

  const safeMaxLength = Math.max(2, Math.min(maxLength, 4096));
  const chunks = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + safeMaxLength, text.length);
    const lastCodeUnit = text.charCodeAt(end - 1);
    const nextCodeUnit = text.charCodeAt(end);
    const splitsSurrogatePair = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
      && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;

    if (splitsSurrogatePair) {
      end--;
    }

    chunks.push(text.slice(offset, end));
    offset = end;
  }

  return chunks;
}

function sanitizeUsername(username) {
  if (!username) {
    return '';
  }
  return username.replace(/[\n\r]/g, '').slice(0, 64);
}

/**
 * Преобразует массив content (текст + изображение) в строку для истории.
 * @param {string | Array<{type: string, text?: string}>} content
 * @returns {string}
 */
function formatContentForHistory(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content);
  }

  const hasImage = content.some((part) => part.type === 'image_url');
  const textParts = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim())
    .map((part) => part.text.trim());

  const prefix = hasImage ? '[image]' : '';
  const text = textParts.join(' ');

  if (prefix && text) {
    return `${prefix} ${text}`;
  }
  return prefix || text || '';
}

module.exports = {
  escapeRegExp,
  buildMentionRegex,
  isMentioned,
  removeMention,
  isReplyToBot,
  truncateMessage,
  splitMessage,
  sanitizeUsername,
  formatContentForHistory,
};
