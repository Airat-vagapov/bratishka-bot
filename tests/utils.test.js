import { describe, it, expect } from 'vitest';
import {
  escapeRegExp,
  isMentioned,
  removeMention,
  isReplyToBot,
  truncateMessage,
  sanitizeUsername,
  formatContentForHistory,
} from '../src/utils.js';

describe('utils', () => {
  describe('escapeRegExp', () => {
    it('escapes special regex characters', () => {
      expect(escapeRegExp('bot.name')).toBe('bot\\.name');
      expect(escapeRegExp('bot+name')).toBe('bot\\+name');
      expect(escapeRegExp('bot[name]')).toBe('bot\\[name\\]');
    });
  });

  describe('isMentioned', () => {
    it('returns true on exact mention', () => {
      expect(isMentioned('@bratishka_bot привет', 'bratishka_bot')).toBe(true);
    });

    it('returns false if username is part of another word', () => {
      expect(isMentioned('@bratishka_bot_test', 'bratishka_bot')).toBe(false);
      expect(isMentioned('email@bratishka_bot', 'bratishka_bot')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isMentioned('@Bratishka_Bot', 'bratishka_bot')).toBe(true);
    });

    it('returns false without username', () => {
      expect(isMentioned('hello', null)).toBe(false);
    });
  });

  describe('removeMention', () => {
    it('removes mention from text', () => {
      expect(removeMention('@bratishka_bot что думаешь?', 'bratishka_bot')).toBe('что думаешь?');
    });

    it('returns trimmed text if no username', () => {
      expect(removeMention('  hello  ', null)).toBe('hello');
    });
  });

  describe('isReplyToBot', () => {
    it('returns true when reply is from bot', () => {
      expect(isReplyToBot({ from: { id: 123 } }, 123)).toBe(true);
      expect(isReplyToBot({ from: { id: '123' } }, 123)).toBe(true);
    });

    it('returns false when reply is from another user', () => {
      expect(isReplyToBot({ from: { id: 456 } }, 123)).toBe(false);
    });

    it('returns false without reply or bot id', () => {
      expect(isReplyToBot(null, 123)).toBe(false);
      expect(isReplyToBot({ from: { id: 123 } }, null)).toBe(false);
    });
  });

  describe('truncateMessage', () => {
    it('does not truncate short messages', () => {
      expect(truncateMessage('short', 100)).toBe('short');
    });

    it('truncates long messages', () => {
      const long = 'a'.repeat(200);
      expect(truncateMessage(long, 100)).toBe('a'.repeat(100) + '…');
    });
  });

  describe('sanitizeUsername', () => {
    it('removes newlines and limits length', () => {
      expect(sanitizeUsername('user\nname')).toBe('username');
      expect(sanitizeUsername('a'.repeat(100))).toBe('a'.repeat(64));
    });
  });

  describe('formatContentForHistory', () => {
    it('returns string content as is', () => {
      expect(formatContentForHistory('hello')).toBe('hello');
    });

    it('formats image content with text', () => {
      const content = [
        { type: 'text', text: 'Что здесь?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } },
      ];
      expect(formatContentForHistory(content)).toBe('[image] Что здесь?');
    });

    it('formats image content without text', () => {
      const content = [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }];
      expect(formatContentForHistory(content)).toBe('[image]');
    });

    it('joins multiple text parts', () => {
      const content = [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ];
      expect(formatContentForHistory(content)).toBe('first second');
    });
  });
});
