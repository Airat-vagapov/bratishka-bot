import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAI } from '../src/openrouter.js';
const require = createRequire(import.meta.url);
const config = require('../src/config.js');

const toolMessage = (calls = [{
  id: 'call_search',
  type: 'function',
  function: { name: 'search_web', arguments: JSON.stringify({ query: 'latest news', topic: 'news' }) },
}]) => ({ role: 'assistant', content: null, tool_calls: calls, reasoning_details: [{ type: 'reasoning.text', text: 'Need fresh information' }] });
const completion = (message) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const searchResponse = { ok: true, json: async () => ({ results: [{ title: 'News', url: 'https://example.com/news', content: 'New release today' }] }) };

describe('OpenRouter client', () => {
  afterEach(() => {
    config.tavilyApiKey = '';
    config.tavilyMonthlyLimit = 900;
    fs.rmSync(path.join(config.dataDirectory, 'tavily-usage.json'), { force: true });
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

  it('does not expose tools when search is disabled or has no key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion({ content: 'answer' }));
    vi.stubGlobal('fetch', fetchMock);
    await askAI([], { webSearch: true });
    config.tavilyApiKey = 'test-search-key';
    await askAI([]);
    config.tavilyMonthlyLimit = 0;
    await askAI([], { webSearch: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, request] of fetchMock.mock.calls) expect(JSON.parse(request.body)).not.toHaveProperty('tools');
  });

  it('lets the model answer without spending a search credit', async () => {
    config.tavilyApiKey = 'test-search-key';
    const fetchMock = vi.fn().mockResolvedValue(completion({ content: 'General knowledge' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(askAI([{ role: 'user', content: 'Explain photosynthesis' }], { webSearch: true })).resolves.toBe('General knowledge');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: false });
    expect(fs.existsSync(path.join(config.dataDirectory, 'tavily-usage.json'))).toBe(false);
  });

  it('executes search, preserves assistant reasoning, and appends actual source URLs', async () => {
    config.tavilyApiKey = 'test-search-key';
    const messages = [{ role: 'user', content: 'What happened today?' }];
    const assistant = toolMessage();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion(assistant))
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(completion({ content: 'A new release [1]' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(askAI(messages, { webSearch: true })).resolves.toBe('A new release [1]\n\nИсточники:\n[1] News\nhttps://example.com/news');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.tavily.com/search');
    const finalBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(finalBody.tool_choice).toBe('none');
    expect(finalBody.messages).toContainEqual(assistant);
    const result = finalBody.messages.find((entry) => entry.role === 'tool');
    expect(result.tool_call_id).toBe('call_search');
    expect(JSON.parse(result.content).results[0]).toMatchObject({ id: 1, content: 'New release today' });
    expect(messages).toEqual([{ role: 'user', content: 'What happened today?' }]);
  });

  it('performs at most one search even if the model asks for several', async () => {
    config.tavilyApiKey = 'test-search-key';
    const first = toolMessage().tool_calls[0];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion(toolMessage([first, { ...first, id: 'call_extra' }])))
      .mockResolvedValueOnce(searchResponse)
      .mockResolvedValueOnce(completion({ content: 'answer' }));
    vi.stubGlobal('fetch', fetchMock);
    await askAI([], { webSearch: true });
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://api.tavily.com/search')).toHaveLength(1);
    const tools = JSON.parse(fetchMock.mock.calls[2][1].body).messages.filter((entry) => entry.role === 'tool');
    expect(tools).toHaveLength(2);
    expect(JSON.parse(tools[1].content).error).toBe('SEARCH_CALL_LIMIT');
  });

  it.each([['unavailable', 500], ['quota', 432], ['empty', null], ['invalid arguments', 'invalid']])('returns an honest fallback for %s search', async (_label, status) => {
    config.tavilyApiKey = 'test-search-key';
    const assistant = toolMessage();
    if (status === 'invalid') assistant.tool_calls[0].function.arguments = 'not json';
    const fetchMock = vi.fn().mockResolvedValueOnce(completion(assistant));
    if (status !== 'invalid') fetchMock.mockResolvedValueOnce(status === null
      ? { ok: true, json: async () => ({ results: [] }) }
      : { ok: false, status });
    fetchMock.mockResolvedValueOnce(completion({ content: 'I cannot confirm current information' }));
    vi.stubGlobal('fetch', fetchMock);
    const answer = await askAI([], { webSearch: true });
    expect(answer).toContain('Актуальные сведения проверить не удалось.');
    expect(answer).not.toContain('Источники:');
    const tools = JSON.parse(fetchMock.mock.calls.at(-1)[1].body).messages.filter((entry) => entry.role === 'tool');
    if (status !== null) expect(JSON.parse(tools[0].content)).toHaveProperty('error');
    if (status === 432) expect(answer).toContain('Лимит веб-поиска исчерпан');
  });

  it('shares one overall deadline between model selection, search, and the final answer', async () => {
    config.tavilyApiKey = 'test-search-key';
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion(toolMessage()))
      .mockResolvedValueOnce(searchResponse)
      .mockImplementation((_url, request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
    vi.stubGlobal('fetch', fetchMock);
    const rejection = expect(askAI([], { webSearch: true })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
