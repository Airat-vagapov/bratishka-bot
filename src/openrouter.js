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
  log(`[OpenRouter] Response received:`, JSON.stringify(data, null, 2));
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected OpenRouter response format');
  }

  const content = data.choices[0].message.content;
  if (content === null || content === undefined) {
    throw new Error('OpenRouter returned null content in response');
  }

  return content.trim();
}

module.exports = { askAI };
