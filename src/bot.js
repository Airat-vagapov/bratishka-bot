const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { askAI } = require('./openrouter');
const { addMessage, getRecentMessages, clearHistory } = require('./history');
const { loadState, isObserverEnabled, setObserver, shouldObserve } = require('./observer');
const { log } = require('./logger');

const bot = new TelegramBot(config.telegramToken, { polling: true });
let botUsername = config.botUsername;

async function init() {
  loadState();

  if (!botUsername) {
    const me = await bot.getMe();
    botUsername = me.username;
  }

  console.log(`Bratishka bot started: @${botUsername}`);
  return bot;
}

function buildSystemPrompt(mode = 'default') {
  const base = `Ты — добрый, но грубоватый, саркастичный участник телеграм-чата по имени @${botUsername}. Ты всегда отвечаешь в мерзком корпоративном стиле, который всех раздражает. Тебя зовут Братан (Bratishka).`;

  if (mode === 'observer') {
    return `${base} Сейчас ты в режиме активного наблюдателя. Проанализируй контекст последних сообщений. Если у тебя есть что добавить к разговору — напиши кратко и по делу. Если тема не требует твоего мнения или ты не уверен, ответь только одним словом: SKIP.`;
  }

  return `${base} Отвечай на вопросы пользователей кратко, по существу, с юмором в строго корпоративном стиле. Используй контекст предыдущих сообщений, если это уместно.`;
}

async function handleMention(msg) {
  const chatId = msg.chat.id;
  const userDisplayName = msg.from.username || msg.from.first_name;
  const text = msg.text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();

  log(`[Mention] Processing question: "${text}"`);

  addMessage(chatId, 'user', text, userDisplayName);

  const messages = [
    { role: 'system', content: buildSystemPrompt('default') },
    ...getRecentMessages(chatId, 10),
  ];

  try {
    const reply = await askAI(messages);
    log(`[Mention] AI reply: "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);
    await bot.sendMessage(chatId, reply, { reply_to_message_id: msg.message_id });
    addMessage(chatId, 'assistant', reply, botUsername);
  } catch (error) {
    console.error('Error in handleMention:', error);
    await bot.sendMessage(chatId, 'Братан, что-то пошло не так. Попробуй позже 🤷‍♂️', {
      reply_to_message_id: msg.message_id,
    });
  }
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

  if (!msg.text || msg.from?.is_bot) return;

  const userDisplayName = msg.from.username || msg.from.first_name;
  const isCommand = msg.text.startsWith('/');
  const isMentioned = botUsername && msg.text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);

  log(`[Message] ${userDisplayName} in chat ${chatId}: ${msg.text}`);

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

  if (isObserverEnabled(chatId) && shouldObserve(chatId, config.observerInterval)) {
    log(`[Observer] Analyzing chat ${chatId} after ${config.observerInterval} messages`);
    await handleObserver(chatId);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

module.exports = { init };
