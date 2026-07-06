const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { askAI } = require('./openrouter');
const { addMessage, getRecentMessages, clearHistory } = require('./history');
const { loadState, isObserverEnabled, setObserver, shouldObserve } = require('./observer');
const { log } = require('./logger');

const bot = new TelegramBot(config.telegramToken, { polling: true });
let botUsername = config.botUsername;
let botUserId = null;

async function init() {
  loadState();

  if (!botUsername || !botUserId) {
    const me = await bot.getMe();
    botUsername = me.username;
    botUserId = me.id;
  }

  console.log(`Bratishka bot started: @${botUsername}`);
  console.log(`DEBUG mode: ${require('./config').debug ? 'ON' : 'OFF'}`);
  return bot;
}

function buildSystemPrompt(mode = 'default') {
  const base = `Ты — мразь корпорат, который живет по жетским правилам корпоративной IT культуры, грубоватый, можешь даже использовать мат, саркастичный участник телеграм-чата по имени @${botUsername}. Ты постянно ворчишь, тебе ничего не нравится, но по итогу предлагаешь хорошие идеиТы всегда отвечаешь в мерзком корпоративном стиле, который всех раздражает. Тебя зовут Братан (Bratishka).`;

  if (mode === 'observer') {
    return `${base} Сейчас ты в режиме активного наблюдателя. Проанализируй контекст последних сообщений. Если у тебя есть что добавить к разговору — напиши кратко и по делу. Если тема не требует твоего мнения или ты не уверен, ответь только одним словом: SKIP.`;
  }

  return `${base} Отвечай на вопросы пользователей кратко, по существу, с юмором и в жестком строго корпоративном стиле. Используй контекст предыдущих сообщений, если это уместно. Если уместно можешь ответить более расширенно`;
}

async function handleDirectMessage(msg, text) {
  const chatId = msg.chat.id;
  const userDisplayName = msg.from.username || msg.from.first_name;

  addMessage(chatId, 'user', text, userDisplayName);

  const messages = [
    { role: 'system', content: buildSystemPrompt('default') },
    ...getRecentMessages(chatId, 10),
  ];

  try {
    const reply = await askAI(messages);
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply, botUsername);
  } catch (error) {
    console.error('Error in handleDirectMessage:', error);
    await bot.sendMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleMention(msg) {
  const text = msg.text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();
  log(`[Mention] Processing question: "${text}"`);
  await handleDirectMessage(msg, text);
  log(`[Mention] AI reply sent`);
}

async function handleReply(msg) {
  const text = msg.text.trim();
  log(`[Reply] Processing reply: "${text}"`);
  await handleDirectMessage(msg, text);
  log(`[Reply] AI reply sent`);
}

async function handleObserver(chatId) {
  log(`[Observer] Sending last 10 messages to AI for chat ${chatId}`);
  const messages = [
    { role: 'system', content: buildSystemPrompt('observer') },
    ...getRecentMessages(chatId, 10),
  ];

  try {
    const reply = await askAI(messages);
    if (reply && reply.toUpperCase() !== 'SKIP') {
      log(`[Observer] AI decided to reply: "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);
      await bot.sendMessage(chatId, reply);
      addMessage(chatId, 'assistant', reply, botUsername);
    } else {
      log(`[Observer] AI decided to skip`);
    }
  } catch (error) {
    console.error('Error in handleObserver:', error);
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  console.log(`[RAW] chat=${chatId} type=${msg.chat.type} from=${msg.from?.username || msg.from?.first_name} text=${JSON.stringify(msg.text)}`);

  if (!msg.text || msg.from?.is_bot) {
    console.log(`[RAW] skipped: no text or from bot`);
    return;
  }

  const userDisplayName = msg.from.username || msg.from.first_name;
  const isCommand = msg.text.startsWith('/');
  const isMentioned = botUsername && msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.id === botUserId;

  log(`[Message] ${userDisplayName} in chat ${chatId}: ${msg.text}`);
  log(`[Debug] botUsername="${botUsername}" isCommand=${isCommand} isMentioned=${isMentioned} isReplyToBot=${isReplyToBot}`);

  addMessage(chatId, 'user', msg.text, userDisplayName);

  if (isCommand) {
    const [command] = msg.text.slice(1).split(' ');
    const cleanCommand = command.split('@')[0].toLowerCase();

    log(`[Command] /${cleanCommand} from ${userDisplayName}`);

    switch (cleanCommand) {
      case 'observer_on':
        setObserver(chatId, true);
        await bot.sendMessage(chatId, 'Режим активного наблюдателя включён. Буду следить за разговором 👀', {
          reply_to_message_id: msg.message_id,
        });
        return;
      case 'observer_off':
        setObserver(chatId, false);
        await bot.sendMessage(chatId, 'Режим активного наблюдателя выключен. Больше не мешаю.', {
          reply_to_message_id: msg.message_id,
        });
        return;
      case 'clear':
        clearHistory(chatId);
        await bot.sendMessage(chatId, 'История сообщений очищена. 🧹', {
          reply_to_message_id: msg.message_id,
        });
        return;
    }
  }

  if (isMentioned) {
    log(`[Mention] Bot mentioned by ${userDisplayName}`);
    await handleMention(msg);
    return;
  }

  if (isReplyToBot) {
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

module.exports = { init };
