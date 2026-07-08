const config = require('./config');
const { log } = require('./logger');

/**
 * Отправляет запрос к OpenRouter API и возвращает текст ответа модели.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} [options]
 * @param {number} [options.temperature=0.8]
 * @returns {Promise<string>}
 */
async function askAI(messages, options = {}) {
  log(`[OpenRouter] Request to model: ${config.openRouterModel}, messages: ${messages.length}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.openRouterRequestTimeout);

  try {
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
        temperature: options.temperature ?? 0.8,
        max_tokens: config.openRouterMaxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    log(`[OpenRouter] Response received, model: ${data.model || config.openRouterModel}, length: ${data?.choices?.[0]?.message?.content?.length || 0}`);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Unexpected OpenRouter response format');
    }

    const content = data.choices[0].message.content;
    if (content === null || content === undefined) {
      throw new Error('OpenRouter returned null content in response');
    }

    return content.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { askAI };
