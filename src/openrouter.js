const config = require('./config');
const { log } = require('./logger');

/**
 * Отправляет запрос к OpenRouter API и возвращает текст ответа модели.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function askAI(messages) {
  log(`[OpenRouter] Request to model: ${config.openRouterModel}`);
  const response = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openRouterApiKey}`,
      'HTTP-Referer': config.openRouterReferer,
      'X-Title': 'Bratishka Bot',
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages,
      temperature: 0.8,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  log(`[OpenRouter] Response received`);
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected OpenRouter response format');
  }

  return data.choices[0].message.content.trim();
}

module.exports = { askAI };
