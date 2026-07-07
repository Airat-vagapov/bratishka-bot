import { describe, it, expect, beforeEach } from 'vitest';
import { isRateLimited, resetRateLimit } from '../src/ratelimit.js';

describe('ratelimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  function makeMsg(chatId = 1, userId = 1) {
    return { chat: { id: chatId }, from: { id: userId } };
  }

  it('allows requests under limit', () => {
    expect(isRateLimited(makeMsg())).toBe(false);
    expect(isRateLimited(makeMsg())).toBe(false);
  });

  it('blocks requests over limit', () => {
    isRateLimited(makeMsg());
    isRateLimited(makeMsg());
    expect(isRateLimited(makeMsg())).toBe(true);
  });

  it('tracks different users separately', () => {
    expect(isRateLimited(makeMsg(1, 1))).toBe(false);
    expect(isRateLimited(makeMsg(1, 1))).toBe(false);
    expect(isRateLimited(makeMsg(1, 2))).toBe(false);
  });
});
