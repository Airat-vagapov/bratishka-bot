const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

function reserveCredit() {
  const usageFile = path.join(config.dataDirectory, 'tavily-usage.json');
  const temporaryFile = `${usageFile}.${process.pid}.tmp`;
  const month = new Date().toISOString().slice(0, 7);
  let usage = { month, requests: 0 };

  try {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stored !== undefined) {
      if (!stored || typeof stored.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(stored.month) ||
          !Number.isSafeInteger(stored.requests) || stored.requests < 0 || stored.month > month) {
        throw new Error('Invalid Tavily usage state');
      }
      if (stored.month === month) usage = stored;
    }
    if (usage.requests >= config.tavilyMonthlyLimit) {
      throw new SearchError('SEARCH_LIMIT_REACHED', 'Monthly search limit reached');
    }

    // Reserve before the network request; failed attempts may still consume a provider credit.
    fs.mkdirSync(config.dataDirectory, { recursive: true });
    fs.writeFileSync(temporaryFile, JSON.stringify({ month, requests: usage.requests + 1 }), { mode: 0o600 });
    fs.renameSync(temporaryFile, usageFile);
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError('SEARCH_STATE_ERROR', 'Cannot safely persist the search budget');
  }
}

function normalizeResults(results) {
  const seen = new Set();
  const normalized = [];
  for (const result of results) {
    if (!result || typeof result.url !== 'string' || typeof result.content !== 'string') continue;
    let url;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
    if (!result.content.trim()) continue;
    seen.add(url.href);
    normalized.push({
      title: typeof result.title === 'string' ? result.title.replace(/\s+/g, ' ').slice(0, 200) : url.hostname,
      url: url.href,
      content: result.content.slice(0, 2000),
    });
    if (normalized.length === 5) break;
  }
  return normalized;
}

async function searchWeb(argumentsValue, { signal } = {}) {
  if (!config.tavilyApiKey) throw new SearchError('SEARCH_DISABLED', 'Search is not configured');
  if (!argumentsValue || typeof argumentsValue.query !== 'string' || !argumentsValue.query.trim() ||
      argumentsValue.query.length > 400 ||
      (argumentsValue.topic !== undefined && !['general', 'news'].includes(argumentsValue.topic)) ||
      (argumentsValue.time_range !== undefined && !['day', 'week', 'month', 'year'].includes(argumentsValue.time_range))) {
    throw new SearchError('SEARCH_INVALID_ARGUMENTS', 'Invalid search arguments');
  }
  signal?.throwIfAborted();
  reserveCredit();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tavilyApiKey}` },
      body: JSON.stringify({
        query: argumentsValue.query.trim(),
        topic: argumentsValue.topic || 'general',
        ...(argumentsValue.time_range ? { time_range: argumentsValue.time_range } : {}),
        search_depth: 'basic',
        auto_parameters: false,
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    if (!response.ok) {
      const code = [432, 433].includes(response.status) ? 'SEARCH_LIMIT_REACHED' : 'SEARCH_UNAVAILABLE';
      throw new SearchError(code, `Tavily HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data?.results)) throw new SearchError('SEARCH_UNAVAILABLE', 'Invalid Tavily response');
    return { results: normalizeResults(data.results) };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SearchError) throw error;
    throw new SearchError('SEARCH_UNAVAILABLE', controller.signal.aborted ? 'Search timed out' : 'Search failed');
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { searchWeb };
