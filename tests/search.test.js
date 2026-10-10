import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchWeb } from '../src/search.js';

const require = createRequire(import.meta.url);
const config = require('../src/config.js');

const originalDirectory = config.dataDirectory;
let directory;
const response = (results = []) => ({ ok: true, json: async () => ({ results }) });
const usageFile = () => path.join(directory, 'tavily-usage.json');
const month = () => new Date().toISOString().slice(0, 7);

describe('Tavily search and monthly budget', () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bratishka-search-'));
    config.dataDirectory = directory;
    config.tavilyApiKey = 'test-search-key';
    config.tavilyMonthlyLimit = 2;
  });

  afterEach(() => {
    config.dataDirectory = originalDirectory;
    config.tavilyApiKey = '';
    config.tavilyMonthlyLimit = 900;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('uses only basic search and filters unsafe, duplicate, and oversized results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { title: 'First\nsource', url: 'https://example.com', content: 'x'.repeat(5000) },
      { url: 'https://example.com/', content: 'duplicate' },
      { url: 'javascript:alert(1)', content: 'unsafe' },
      { url: 'https://secret:password@example.org', content: 'credentials' },
      { url: 'invalid', content: 'bad url' },
      { url: 'https://empty.example.com', content: '   ' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const result = await searchWeb({ query: ' fresh news ', topic: 'news', time_range: 'day' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ title: 'First source', url: 'https://example.com/' });
    expect(result.results[0].content).toHaveLength(2000);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(request.headers.Authorization).toBe('Bearer test-search-key');
    expect(JSON.parse(request.body)).toMatchObject({ query: 'fresh news', topic: 'news', time_range: 'day', search_depth: 'basic', auto_parameters: false, max_results: 5 });
    expect(JSON.parse(fs.readFileSync(usageFile(), 'utf8'))).toEqual({ month: month(), requests: 1 });
  });

  it('reserves credits before concurrent calls and stops exactly at the budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([1, 2, 3].map(() => searchWeb({ query: 'query' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results[2].reason.code).toBe('SEARCH_LIMIT_REACHED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors persisted usage after restart and resets a previous calendar month', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    fs.writeFileSync(usageFile(), JSON.stringify({ month: month(), requests: 2 }));
    await expect(searchWeb({ query: 'query' })).rejects.toMatchObject({ code: 'SEARCH_LIMIT_REACHED' });
    expect(fetchMock).not.toHaveBeenCalled();
    fs.writeFileSync(usageFile(), JSON.stringify({ month: '2000-01', requests: 1000 }));
    await searchWeb({ query: 'query' });
    expect(JSON.parse(fs.readFileSync(usageFile(), 'utf8'))).toEqual({ month: month(), requests: 1 });
  });

  it.each(['not json', JSON.stringify({ month: 'bad', requests: 0 }), JSON.stringify({ month: '2999-01', requests: 0 })])('blocks search when quota state is corrupt', async (state) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fs.writeFileSync(usageFile(), state);
    await expect(searchWeb({ query: 'query' })).rejects.toMatchObject({ code: 'SEARCH_STATE_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not spend credits for invalid or disabled searches', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(searchWeb({ query: '', topic: 'general' })).rejects.toMatchObject({ code: 'SEARCH_INVALID_ARGUMENTS' });
    await expect(searchWeb({ query: 'query', topic: 'invalid' })).rejects.toMatchObject({ code: 'SEARCH_INVALID_ARGUMENTS' });
    config.tavilyApiKey = '';
    await expect(searchWeb({ query: 'query' })).rejects.toMatchObject({ code: 'SEARCH_DISABLED' });
    expect(fs.existsSync(usageFile())).toBe(false);
  });

  it('keeps a reservation after a failed request because provider billing is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure with secret data')));
    await expect(searchWeb({ query: 'query' })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE', message: 'Search failed' });
    expect(JSON.parse(fs.readFileSync(usageFile(), 'utf8')).requests).toBe(1);
  });

  it('times out search without leaking the timeout timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const result = expect(searchWeb({ query: 'query' })).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE', message: 'Search timed out' });
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates cancellation and spends no credit for a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn());
    await expect(searchWeb({ query: 'query' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.existsSync(usageFile())).toBe(false);
  });
});
