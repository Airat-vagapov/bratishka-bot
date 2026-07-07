const config = require('./config');

/** @type {Map<string, Array<number>>} */
const rateLimitMap = new Map();

function getRateLimitKey(msg) {
  return `${msg.chat.id}:${msg.from.id}`;
}

function isRateLimited(msg) {
  const key = getRateLimitKey(msg);
  const now = Date.now();
  const requests = rateLimitMap.get(key) || [];
  const recentRequests = requests.filter((time) => now - time < config.rateLimitWindowMs);

  if (recentRequests.length >= config.rateLimitMaxRequests) {
    return true;
  }

  recentRequests.push(now);
  rateLimitMap.set(key, recentRequests);
  return false;
}

function resetRateLimit() {
  rateLimitMap.clear();
}

module.exports = { isRateLimited, resetRateLimit };
