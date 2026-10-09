import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAI } from '../src/openrouter.js';

describe('OpenRouter client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the configured request and trims the model response', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  **answer**  ' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(askAI(messages, { temperature: 0.4 })).resolves.toBe('answer');

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/chat\/completions$/);
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
      'X-Title': 'Bratishka Bot',
    });
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: 0.4,
      max_tokens: 4096,
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('includes the API response body in non-success errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    await expect(askAI([])).rejects.toThrow('OpenRouter API error 429: rate limited');
  });

  it.each([
    [{ choices: [] }, 'Unexpected OpenRouter response format'],
    [{ choices: [{ message: { content: null } }] }, 'OpenRouter returned null content in response'],
  ])('rejects invalid API response data', async (body, errorMessage) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }));

    await expect(askAI([])).rejects.toThrow(errorMessage);
  });

  it('aborts requests after the configured timeout', async () => {
    vi.useFakeTimers();
    let requestSignal;
    vi.stubGlobal('fetch', vi.fn((_url, request) => {
      requestSignal = request.signal;
      return new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));

    const request = askAI([]);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30000);

    await rejection;
    expect(requestSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
