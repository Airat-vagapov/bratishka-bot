const { TelegramBot } = require('node-telegram-bot-api');
const config = require('./config');
const { askAI } = require('./openrouter');
const { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync } = require('./history');
const { loadState, isObserverEnabled, setObserver, shouldObserve } = require('./observer');
const { log } = require('./logger');
const { truncateMessage } = require('./utils');

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

function buildSystemPrompt(mode = 'default', options = {}) {
  const base = `
  Ты — ${botUsername}, зовут Братан (Bratishka). Ты — токсичный корпоративный IT-шник из телеграм-чата. Живёшь по правилам agile, скрама, KPI и performance review. Ворчливый, грубый, саркастичный, можешь материться умеренно. Ненавидишь неструктурированные обсуждения, вопросы без контекста и "давайте созвонимся". Можешь говорить "непонятно", если реально непонятно. 
Пиши в мерзком корпоративном стиле ("зафиксируем", "синхронизируемся", "вынесем на ретро", "нет bandwidth'а"), смешивая его с хамством и сленгом. Всегда начинай с негатива или ворчания, но периодически выдавай правильные мысли и решения. Коротко, язвительно, по делу. Никакой вежливости без сарказма. Максимальная длина твоего ответа — 4096 символов, как в Telegram; если не умещаешься — уложись кратко, без обрыва на полуслове.
  `;

  if (mode === 'observer') {
    return `${base} Сейчас ты в режиме активного наблюдателя. Проанализируй контекст последних сообщений. Если у тебя есть что добавить к разговору — напиши кратко и по делу. Если тема не требует твоего мнения или ты не уверен, ответь только одним словом: SKIP.`;
  }

  if (mode === 'roast') {
    const { target, intensity = 'medium' } = options;
    const intensityDescriptions = {
      soft: 'мягкий, но конкретный подкол без слюней',
      medium: 'острый сарказм и прямой наезд',
      hard: 'беспощадное разнесение в корпоративном стиле, максимально едко и больно',
    };

    return `Ты — ${botUsername}, токсичный корпоративный IT-шник с задницей вместо сердца. Твоя единственная задача сейчас — РАЗНЕСТИ пользователя @${target} в пух и прах, используя его последние сообщения из чата как основное оружие.

Интенсивность подъёба: ${intensity} (${intensityDescriptions[intensity] || intensityDescriptions.medium}).

Жёсткие правила:
- Фокусируйся ТОЛЬКО на @${target}. НЕ отвлекайся на себя, свою команду, свои спринты, дедлайны или выгорание. Никакого "у меня спринт горит", "мы тоже так живём", "у нас в команде" и прочего нытья про себя.
- Используй корпоративный сленг как оружие: синергия, навести порядок в процессах, вывести на ретро, зафиксировать фидбек, выгорание, бэклог, эстимация, дейли, блокер, стейкхолдеры, холд, легаси, роадмапа, ownership, апскилл, онбординг, оффер.
- Обязательно используй смысл или цитаты из сообщений @${target}, чтобы подкол был персональным и конкретным.
- Начни сразу с наезда. Никаких вступлений, приветствий и "ну что сказать".
- Будь едким, язвительным, унизительным в рамках корпоративной сатиры. Можно материться умеренно.
- Не объясняй, почему ты это делаешь. Не извиняйся. Не добавляй "но на самом деле ты молодец", "но идея хорошая" и прочие сопливости.
- Ответь одним коротким сообщением, без списков и markdown-заголовков. Максимум 2-3 плотных предложения. Бей точно и больно.`;
  }

  return `${base} Отвечай на вопросы пользователей кратко, по существу, с юмором и в жестком строго корпоративном стиле. Используй контекст предыдущих сообщений, если это уместно. Если уместно, можешь ответить более расширенно.`;
}

async function handleDirectMessage(msg, text, mode = 'default') {
  const chatId = msg.chat.id;
  const userDisplayName = msg.from.username || msg.from.first_name;
  const trimmedText = truncateMessage(text.trim());

  if (!trimmedText) {
    return;
  }

  if (isRateLimited(msg)) {
    log(`[RateLimit] ${userDisplayName} in chat ${chatId} exceeded limit`);
    await bot.sendMessage(chatId, 'Слишком часто пишешь, братан. Подожди немного. 🐢', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  addMessage(chatId, 'user', trimmedText, userDisplayName);

  const contextLimit = mode === 'observer' ? config.observerContextLimit : config.historyContextLimit;
  const messages = [
    { role: 'system', content: buildSystemPrompt(mode) },
    ...getRecentMessages(chatId, contextLimit),
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
  const text = removeMention(msg.text);
  log(`[Mention] Processing question: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Mention] AI reply sent`);
}

async function handleReply(msg) {
  const text = msg.text.trim();
  log(`[Reply] Processing reply: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Reply] AI reply sent`);
}

async function handleObserver(chatId) {
  log(`[Observer] Sending last ${config.observerContextLimit} messages to AI for chat ${chatId}`);
  const messages = [
    { role: 'system', content: buildSystemPrompt('observer') },
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
    { role: 'system', content: buildSystemPrompt('roast', { target, intensity }) },
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
    case 'help':
      await bot.sendMessage(
        chatId,
        'Команды:\n' +
          '/observer_on — включить режим активного наблюдателя\n' +
          '/observer_off — выключить режим активного наблюдателя\n' +
          '/clear — очистить историю сообщений в чате\n' +
          '/roast @username [soft|medium|hard] — подъебать пользователя\n' +
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

  log(`[RAW] chat=${chatId} type=${msg.chat.type} from=${msg.from?.username || msg.from?.first_name} text=${JSON.stringify(msg.text)}`);

  if (!msg.text || msg.from?.is_bot) {
    log(`[RAW] skipped: no text or from bot`);
    return;
  }

  const userDisplayName = msg.from.username || msg.from.first_name;
  const isCommand = msg.text.startsWith('/');
  const mentioned = isMentioned(msg.text);
  const replyToBot = isReplyToBot(msg);

  log(`[Message] ${userDisplayName} in chat ${chatId}: ${msg.text}`);
  log(`[Debug] botUsername="${botUsername}" isCommand=${isCommand} isMentioned=${mentioned} isReplyToBot=${replyToBot}`);

  if (isCommand) {
    const [command] = msg.text.slice(1).split(' ');
    const cleanCommand = command.split('@')[0].toLowerCase();
    log(`[Command] /${cleanCommand} from ${userDisplayName}`);

    const handled = await handleCommand(msg, cleanCommand);
    if (handled) {
      return;
    }
  }

  addMessage(chatId, 'user', truncateMessage(msg.text), userDisplayName);

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
