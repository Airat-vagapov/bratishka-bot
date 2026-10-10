const { TelegramBot } = require('node-telegram-bot-api');
const config = require('./config');
const { askAI } = require('./openrouter');
const { addMessage, getRecentMessages, getMessagesByUser, clearHistory, saveHistorySync } = require('./history');
const { loadState, isObserverEnabled, getObserverGeneration, setObserver, shouldObserve } = require('./observer');
const { log } = require('./logger');
const { truncateMessage, splitMessage, isMentioned, isReplyToBot, removeMention, buildReplyContext } = require('./utils');
const { isRateLimited } = require('./ratelimit');
const { downloadPhoto, prepareImage, bufferToBase64DataUrl } = require('./vision');
const { getPersonality, listPersonalities, isValidPersonality } = require('./personalities');
const { loadState: loadPersonalityState, getChatPersonality, setChatPersonality } = require('./personalityState');

const bot = new TelegramBot(config.telegramToken, { polling: false });
let botUsername = config.botUsername;
let botUserId = null;
let isShuttingDown = false;
let initialization = null;
let shutdownPromise = null;
const activeMessageHandlers = new Set();
const SHUTDOWN_DRAIN_TIMEOUT_MS = 40_000;
const SHUTDOWN_HISTORY_TIMEOUT_MS = 5_000;

function waitWithTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const observed = Promise.resolve(promise);
  observed.catch(() => {});

  return Promise.race([
    observed,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const chunks = splitMessage(text);
  if (chunks.length === 0) {
    throw new Error('Cannot send an empty Telegram message');
  }

  let sentMessage;
  for (const [index, chunk] of chunks.entries()) {
    sentMessage = await bot.sendMessage(chatId, chunk, index === 0 ? options : {});
  }
  return sentMessage;
}

async function sendRateLimitNotice(msg) {
  if (!isRateLimited(msg)) {
    return false;
  }

  const userDisplayName = msg.from?.username || msg.from?.first_name || 'unknown';
  log(`[RateLimit] ${userDisplayName} in chat ${msg.chat.id} exceeded limit`);
  await sendTelegramMessage(msg.chat.id, 'Слишком часто пишешь, братан. Подожди немного. 🐢', {
    reply_to_message_id: msg.message_id,
  });
  return true;
}

function parseCommand(text, entities = []) {
  const commandEntity = entities.find((entity) => entity.type === 'bot_command' && entity.offset === 0);
  const commandText = commandEntity ? text.slice(0, commandEntity.length) : text;
  const match = commandEntity
    ? commandText.match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?$/i)
    : commandText.match(/^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?=\s|$)/i);
  if (!match) {
    return null;
  }
  return { name: match[1].toLowerCase(), target: match[2] || null };
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

  const contextLimit = mode === 'observer' ? config.observerContextLimit : config.historyContextLimit;
  const historyLimit = Math.max(0, contextLimit - 1);
  const history = historyLimit > 0 ? getRecentMessages(chatId, historyLimit) : [];
  addMessage(chatId, 'user', content, userDisplayName);

  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, mode) },
    ...history,
    { role: 'user', content },
  ];

  try {
    const reply = await askAI(messages);
    await sendTelegramMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply);
  } catch (error) {
    console.error('Error in handleDirectMessage:', error);
    await sendTelegramMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleMention(msg) {
  const replyContext = buildReplyContext(msg, botUserId);
  let text = removeMention(msg.text || msg.caption || '', botUsername);
  if (replyContext) {
    text = `${replyContext}\n\n${text}`;
  }
  if (await sendRateLimitNotice(msg)) {
    return;
  }
  log(`[Mention] Processing question: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Mention] AI reply sent`);
}

async function handleReply(msg) {
  const replyContext = buildReplyContext(msg, botUserId);
  let text = (msg.text || msg.caption || '').trim();
  if (replyContext) {
    text = `${replyContext}\n\n${text}`;
  }
  if (await sendRateLimitNotice(msg)) {
    return;
  }
  log(`[Reply] Processing reply: "${text}"`);
  await handleDirectMessage(msg, text, 'default');
  log(`[Reply] AI reply sent`);
}

async function handlePhotoMessage(msg) {
  const chatId = msg.chat.id;
  const caption = msg.caption || '';
  const text = removeMention(caption, botUsername);

  if (await sendRateLimitNotice(msg)) {
    return;
  }

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
    await sendTelegramMessage(chatId, 'Братан, не удалось обработать фото. Попробуй другое 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleObserver(chatId) {
  log(`[Observer] Sending last ${config.observerContextLimit} messages to AI for chat ${chatId}`);
  const generation = getObserverGeneration(chatId);
  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, 'observer') },
    ...getRecentMessages(chatId, config.observerContextLimit),
  ];

  try {
    const reply = await askAI(messages);
    if (reply && reply.toUpperCase() !== 'SKIP') {
      if (!isObserverEnabled(chatId) || getObserverGeneration(chatId) !== generation) {
        log(`[Observer] Discarding stale reply for chat ${chatId}`);
        return;
      }
      log(`[Observer] AI decided to reply: "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);
      await sendTelegramMessage(chatId, reply);
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
    await sendTelegramMessage(
      chatId,
      'Братан, укажи кого подъебывать: /roast @username [soft|medium|hard]',
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  const { target, intensity } = parsed;

  if (target.toLowerCase() === botUsername.toLowerCase()) {
    await sendTelegramMessage(chatId, 'Себя подъебывать не буду. Найди себе другую жертву. 🖕', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  const targetMessages = getMessagesByUser(chatId, target, 10);

  if (targetMessages.length === 0) {
    await sendTelegramMessage(
      chatId,
      `У @${target} пока нет материала для подъёба. Пусть сначала что-нибудь напишет. 📭`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  if (await sendRateLimitNotice(msg)) {
    return;
  }

  log(`[Roast] Roasting @${target} with intensity ${intensity} in chat ${chatId}`);

  const messages = [
    { role: 'system', content: buildSystemPrompt(chatId, 'roast', { target, intensity }) },
    ...targetMessages,
  ];

  try {
    const reply = await askAI(messages, { temperature: 1.0 });
    await sendTelegramMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply);
    log(`[Roast] AI roast sent`);
  } catch (error) {
    console.error('Error in handleRoast:', error);
    await sendTelegramMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
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
    await sendTelegramMessage(
      chatId,
      `Текущая личность: *${getPersonality(current).displayName}* (${current}).\n\nДоступные личности:\n${list}`,
      { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' }
    );
    return;
  }

  const requested = args[0].toLowerCase();
  if (!isValidPersonality(requested)) {
    const valid = listPersonalities().map((p) => p.name).join(', ');
    await sendTelegramMessage(
      chatId,
      `Не знаю такой личности: "${requested}". Доступные: ${valid}.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  setChatPersonality(chatId, requested);
  const personality = getPersonality(requested);
  await sendTelegramMessage(
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
      await sendTelegramMessage(chatId, 'Режим активного наблюдателя включён. Буду следить за разговором 👀', {
        reply_to_message_id: msg.message_id,
      });
      return true;
    case 'observer_off':
      setObserver(chatId, false);
      await sendTelegramMessage(chatId, 'Режим активного наблюдателя выключен. Больше не мешаю.', {
        reply_to_message_id: msg.message_id,
      });
      return true;
    case 'clear':
      clearHistory(chatId);
      await sendTelegramMessage(chatId, 'История сообщений очищена. 🧹', {
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
      await sendTelegramMessage(
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

async function handleMessage(msg) {
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
  const mentioned = isMentioned(text, botUsername);
  const replyToBot = isReplyToBot(msg.reply_to_message, botUserId);

  log(`[Message] ${userDisplayName} in chat ${chatId}: ${text || '[photo]'}`);
  log(`[Debug] botUsername="${botUsername}" isCommand=${isCommand} isMentioned=${mentioned} isReplyToBot=${replyToBot} isPhoto=${isPhoto}`);

  // В групповых чатах фото обрабатываем только при явном упоминании или ответе боту.
  if (isPhoto && !isPrivate && !mentioned && !replyToBot) {
    log(`[RAW] skipped: photo in group without mention/reply`);
    return;
  }

  if (isCommand && !isPhoto) {
    const command = parseCommand(text, msg.entities);
    if (command && command.target && command.target.toLowerCase() !== botUsername.toLowerCase()) {
      return;
    }
    if (command) {
      log(`[Command] /${command.name} from ${userDisplayName}`);
      const handled = await handleCommand(msg, command.name);
      if (handled) {
        return;
      }
    }
  }

  if (isPhoto) {
    log(`[Photo] Bot received a photo from ${userDisplayName}`);
    await handlePhotoMessage(msg);
    return;
  }

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

  addMessage(chatId, 'user', truncateMessage(text), userDisplayName);

  if (isObserverEnabled(chatId) && shouldObserve(chatId, config.observerInterval)) {
    log(`[Observer] Analyzing chat ${chatId} after ${config.observerInterval} messages`);
    await handleObserver(chatId);
  }
}

bot.on('message', (msg) => {
  const task = handleMessage(msg).catch((error) => {
    console.error('Error processing Telegram message:', error);
  });
  activeMessageHandlers.add(task);
  task.finally(() => activeMessageHandlers.delete(task));
  return task;
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

async function startBot() {
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

  if (isShuttingDown) {
    return bot;
  }

  await bot.startPolling();
  if (isShuttingDown) {
    await bot.stopPolling({ cancel: true });
    return bot;
  }

  console.log(`Bratishka bot started: @${botUsername}`);
  console.log(`DEBUG mode: ${config.debug ? 'ON' : 'OFF'}`);
  return bot;
}

function init() {
  if (!initialization) {
    initialization = startBot();
  }
  return initialization;
}

async function performShutdown() {
  console.log('Shutting down gracefully...');

  const pendingWork = [
    Promise.resolve().then(() => bot.stopPolling({ cancel: true })),
    ...(initialization ? [initialization] : []),
    ...activeMessageHandlers,
  ];

  let shutdownError = null;
  try {
    const outcomes = await waitWithTimeout(
      Promise.allSettled(pendingWork),
      SHUTDOWN_DRAIN_TIMEOUT_MS,
      'Polling and handler drain'
    );
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure) {
      shutdownError = failure.reason;
    }
  } catch (error) {
    shutdownError = error;
    console.error('Error draining bot work:', error);
  }

  try {
    await waitWithTimeout(
      Promise.resolve().then(() => saveHistorySync()),
      SHUTDOWN_HISTORY_TIMEOUT_MS,
      'Final history save'
    );
  } catch (error) {
    console.error('Error saving history:', error);
    shutdownError ||= error;
  }

  if (shutdownError) {
    throw shutdownError;
  }

  console.log('Shutdown complete.');
}

function shutdown() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  isShuttingDown = true;
  shutdownPromise = performShutdown();
  return shutdownPromise;
}

module.exports = { init, shutdown };
