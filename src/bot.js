const { TelegramBot } = require('node-telegram-bot-api');
const config = require('./config');
const { askAI } = require('./openrouter');
const { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync } = require('./history');
const { loadState, isObserverEnabled, setObserver, shouldObserve } = require('./observer');
const { log } = require('./logger');
const { truncateMessage } = require('./utils');
const { downloadPhoto, prepareImage, bufferToBase64DataUrl } = require('./vision');
const { getPersonality, listPersonalities, isValidPersonality } = require('./personalities');
const { loadState: loadPersonalityState, getChatPersonality, setChatPersonality } = require('./personalityState');

const bot = new TelegramBot(config.telegramToken, { polling: false });
let botUsername = config.botUsername;
let botUserId = null;
let isShuttingDown = false;

/** @type {Map<string | number, Array<number>>} */
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMentionRegex() {
  if (!botUsername) {
    return null;
  }
  return new RegExp(`@${escapeRegExp(botUsername)}\\b`, 'gi');
}

function isMentioned(text) {
  if (!botUsername) {
    return false;
  }
  return getMentionRegex().test(text);
}

function removeMention(text) {
  if (!botUsername) {
    return text;
  }
  return text.replace(getMentionRegex(), '').trim();
}

function isReplyToBot(msg) {
  if (!msg.reply_to_message || !msg.reply_to_message.from || botUserId === null) {
    return false;
  }
  return Number(msg.reply_to_message.from.id) === botUserId;
}

function parseRoastCommand(text) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const target = parts[1].replace(/^@/, '');
  const intensity = ['soft', 'medium', 'hard'].includes(parts[2]?.toLowerCase())
    ? parts[2].toLowerCase()
    : 'hard';

  return { target, intensity };
}

function buildSystemPrompt(chatId, mode = 'default', options = {}) {
  const personality = getPersonality(getChatPersonality(chatId));

  if (mode === 'observer') {
    return `${personality.basePrompt} ${personality.observerSuffix || ''}`.trim();
  }

  if (mode === 'roast') {
    const { target, intensity = 'medium' } = options;
    const intensityDescriptions = {
      soft: 'мягкий, но конкретный подкол без слюней',
      medium: 'острый сарказм и прямой наезд',
      hard: 'беспощадное разнесение, максимально едко и больно',
    };

    return `Ты — ${botUsername}. ${personality.basePrompt}

Сейчас ты в режиме подъёба.

${personality.roastSuffix || ''}

Интенсивность подъёба: ${intensity} (${intensityDescriptions[intensity] || intensityDescriptions.medium}).

Целевой пользователь: @${target}.`;
  }

  return `${personality.basePrompt} Отвечай на вопросы пользователей кратко, по существу, с юмором и в своём характере. Используй контекст предыдущих сообщений, если это уместно. Если уместно, можешь ответить более расширенно.`;
}

async function handleDirectMessage(msg, content, mode = 'default') {
  const chatId = msg.chat.id;
  const userDisplayName = msg.from.username || msg.from.first_name;
  const isArrayContent = Array.isArray(content);
  const textPreview = isArrayContent
    ? content.filter((part) => part.type === 'text').map((part) => part.text).join(' ')
    : truncateMessage(content.trim());

  if (!isArrayContent && !textPreview) {
    return;
  }

  if (isRateLimited(msg)) {
    log(`[RateLimit] ${userDisplayName} in chat ${chatId} exceeded limit`);
    await bot.sendMessage(chatId, 'Слишком часто пишешь, братан. Подожди немного. 🐢', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  addMessage(chatId, 'user', content, userDisplayName);

  const contextLimit = mode === 'observer' ? config.observerContextLimit : config.historyContextLimit;
  const history = getRecentMessages(chatId, contextLimit);

  // Убираем только что добавленное сообщение, так как оно сохранено в виде строки,
  // а для multimodal-запросов нужен оригинальный content (массив).
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    history.pop();
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, mode) },
    ...history,
    { role: 'user', content },
  ];

  try {
    const reply = await askAI(messages);
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply);
  } catch (error) {
    console.error('Error in handleDirectMessage:', error);
    await bot.sendMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleMention(msg) {
  const text = removeMention(msg.text || msg.caption || '');
  log(`[Mention] Processing question: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Mention] AI reply sent`);
}

async function handleReply(msg) {
  const text = (msg.text || msg.caption || '').trim();
  log(`[Reply] Processing reply: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Reply] AI reply sent`);
}

async function handlePhotoMessage(msg) {
  const chatId = msg.chat.id;
  const caption = msg.caption || '';
  const text = removeMention(caption);

  try {
    const photo = msg.photo[msg.photo.length - 1];
    log(`[Photo] Downloading file_id=${photo.file_id} for chat ${chatId}`);
    const buffer = await downloadPhoto(photo.file_id, bot.getFileLink.bind(bot));
    const prepared = await prepareImage(buffer);
    const dataUrl = bufferToBase64DataUrl(prepared);

    const content = [
      { type: 'text', text: text || 'Опиши, что на картинке.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ];

    log(`[Photo] Prepared image for chat ${chatId}, size=${prepared.length}`);
    await handleDirectMessage(msg, content, 'default');
  } catch (error) {
    console.error('Error in handlePhotoMessage:', error);
    await bot.sendMessage(chatId, 'Братан, не удалось обработать фото. Попробуй другое 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleObserver(chatId) {
  log(`[Observer] Sending last ${config.observerContextLimit} messages to AI for chat ${chatId}`);
  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, 'observer') },
    ...getRecentMessages(chatId, config.observerContextLimit),
  ];

  try {
    const reply = await askAI(messages);
    if (reply && reply.toUpperCase() !== 'SKIP') {
      log(`[Observer] AI decided to reply: "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);
      await bot.sendMessage(chatId, reply);
      addMessage(chatId, 'assistant', reply);
    } else {
      log(`[Observer] AI decided to skip`);
    }
  } catch (error) {
    console.error('Error in handleObserver:', error);
  }
}

async function handleRoast(msg) {
  const chatId = msg.chat.id;
  const parsed = parseRoastCommand(msg.text);

  if (!parsed) {
    await bot.sendMessage(
      chatId,
      'Братан, укажи кого подъебывать: /roast @username [soft|medium|hard]',
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  const { target, intensity } = parsed;

  if (target.toLowerCase() === botUsername.toLowerCase()) {
    await bot.sendMessage(chatId, 'Себя подъебывать не буду. Найди себе другую жертву. 🖕', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  const targetMessages = getMessagesByUser(chatId, target, 10);

  if (targetMessages.length === 0) {
    await bot.sendMessage(
      chatId,
      `У @${target} пока нет материала для подъёба. Пусть сначала что-нибудь напишет. 📭`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  if (isRateLimited(msg)) {
    log(`[RateLimit] ${msg.from.username || msg.from.first_name} in chat ${chatId} exceeded limit`);
    await bot.sendMessage(chatId, 'Слишком часто пишешь, братан. Подожди немного. 🐢', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  log(`[Roast] Roasting @${target} with intensity ${intensity} in chat ${chatId}`);

  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, 'roast', { target, intensity }) },
    ...targetMessages,
  ];

  try {
    const reply = await askAI(messages, { temperature: 1.0 });
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply);
    log(`[Roast] AI roast sent`);
  } catch (error) {
    console.error('Error in handleRoast:', error);
    await bot.sendMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handlePersonality(msg) {
  const chatId = msg.chat.id;
  const args = msg.text.trim().split(/\s+/).slice(1);
  const current = getChatPersonality(chatId);

  if (args.length === 0) {
    const list = listPersonalities()
      .map((p) => `${p.name === current ? '✅' : '◻️'} /personality ${p.name} — ${p.displayName}: ${p.description}`)
      .join('\n');
    await bot.sendMessage(
      chatId,
      `Текущая личность: *${getPersonality(current).displayName}* (${current}).\n\nДоступные личности:\n${list}`,
      { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' }
    );
    return;
  }

  const requested = args[0].toLowerCase();
  if (!isValidPersonality(requested)) {
    const valid = listPersonalities().map((p) => p.name).join(', ');
    await bot.sendMessage(
      chatId,
      `Не знаю такой личности: "${requested}". Доступные: ${valid}.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  setChatPersonality(chatId, requested);
  const personality = getPersonality(requested);
  await bot.sendMessage(
    chatId,
    `Личность сменена на *${personality.displayName}*. ${personality.description}`,
    { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' }
  );
}

async function handleCommand(msg, command) {
  const chatId = msg.chat.id;

  switch (command) {
    case 'observer_on':
      setObserver(chatId, true);
      await bot.sendMessage(chatId, 'Режим активного наблюдателя включён. Буду следить за разговором 👀', {
        reply_to_message_id: msg.message_id,
      });
      return true;
    case 'observer_off':
      setObserver(chatId, false);
      await bot.sendMessage(chatId, 'Режим активного наблюдателя выключен. Больше не мешаю.', {
        reply_to_message_id: msg.message_id,
      });
      return true;
    case 'clear':
      clearHistory(chatId);
      await bot.sendMessage(chatId, 'История сообщений очищена. 🧹', {
        reply_to_message_id: msg.message_id,
      });
      return true;
    case 'roast':
      await handleRoast(msg);
      return true;
    case 'personality':
      await handlePersonality(msg);
      return true;
    case 'help':
      await bot.sendMessage(
        chatId,
        'Команды:\n' +
          '/observer_on — включить режим активного наблюдателя\n' +
          '/observer_off — выключить режим активного наблюдателя\n' +
          '/clear — очистить историю сообщений в чате\n' +
          '/roast @username [soft|medium|hard] — подъебать пользователя\n' +
          '/personality [имя] — сменить личность бота в этом чате\n' +
          '/help — показать эту справку\n\n' +
          'Также можно тегнуть меня (@' +
          botUsername +
          ') или ответить на моё сообщение.',
        { reply_to_message_id: msg.message_id }
      );
      return true;
    default:
      return false;
  }
}

bot.on('message', async (msg) => {
  if (isShuttingDown) {
    return;
  }

  const chatId = msg.chat.id;
  const userDisplayName = msg.from?.username || msg.from?.first_name || 'unknown';
  const text = msg.text || msg.caption || '';
  const isPhoto = Boolean(msg.photo && msg.photo.length > 0);
  const isPrivate = msg.chat.type === 'private';

  log(`[RAW] chat=${chatId} type=${msg.chat.type} from=${userDisplayName} text=${JSON.stringify(text)} photo=${isPhoto}`);

  if (msg.from?.is_bot) {
    log(`[RAW] skipped: from bot`);
    return;
  }

  if (!text && !isPhoto) {
    log(`[RAW] skipped: no text or photo`);
    return;
  }

  const isCommand = text.startsWith('/');
  const mentioned = isMentioned(text);
  const replyToBot = isReplyToBot(msg);

  log(`[Message] ${userDisplayName} in chat ${chatId}: ${text || '[photo]'}`);
  log(`[Debug] botUsername="${botUsername}" isCommand=${isCommand} isMentioned=${mentioned} isReplyToBot=${replyToBot} isPhoto=${isPhoto}`);

  // В групповых чатах фото обрабатываем только при явном упоминании или ответе боту.
  if (isPhoto && !isPrivate && !mentioned && !replyToBot) {
    log(`[RAW] skipped: photo in group without mention/reply`);
    return;
  }

  if (isCommand && !isPhoto) {
    const [command] = text.slice(1).split(' ');
    const cleanCommand = command.split('@')[0].toLowerCase();
    log(`[Command] /${cleanCommand} from ${userDisplayName}`);

    const handled = await handleCommand(msg, cleanCommand);
    if (handled) {
      return;
    }
  }

  if (isPhoto) {
    log(`[Photo] Bot received a photo from ${userDisplayName}`);
    await handlePhotoMessage(msg);
    return;
  }

  addMessage(chatId, 'user', truncateMessage(text), userDisplayName);

  if (mentioned) {
    log(`[Mention] Bot mentioned by ${userDisplayName}`);
    await handleMention(msg);
    return;
  }

  if (replyToBot) {
    log(`[Reply] ${userDisplayName} replied to bot's message`);
    await handleReply(msg);
    return;
  }

  if (isObserverEnabled(chatId) && shouldObserve(chatId, config.observerInterval)) {
    log(`[Observer] Analyzing chat ${chatId} after ${config.observerInterval} messages`);
    await handleObserver(chatId);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

async function init() {
  loadState();
  loadPersonalityState();

  try {
    const me = await bot.getMe();
    botUsername = me.username;
    botUserId = Number(me.id);
  } catch (error) {
    console.error('Failed to get bot info:', error);
    throw error;
  }

  await bot.startPolling();

  console.log(`Bratishka bot started: @${botUsername}`);
  console.log(`DEBUG mode: ${config.debug ? 'ON' : 'OFF'}`);
  return bot;
}

async function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log('Shutting down gracefully...');

  try {
    await bot.stopPolling();
  } catch (error) {
    console.error('Error stopping polling:', error);
  }

  try {
    await saveHistorySync();
  } catch (error) {
    console.error('Error saving history:', error);
  }

  console.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { init, shutdown };
