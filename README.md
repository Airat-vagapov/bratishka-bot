# Bratishka Bot 🤖

Telegram-бот с ИИ-интеграцией через [OpenRouter API](https://openrouter.ai/). Умеет отвечать на упоминания и автоматически высказывать мнение в режиме активного наблюдателя.

## Возможности

- **Ответы на упоминания** — тегни бота в чате (`@bratishka_bot что думаешь?`), и он ответит, опираясь на контекст последних сообщений.
- **Режим активного наблюдателя** — бот следит за перепиской и периодически анализирует контекст. Если у него есть что добавить, он выскажется сам.
- **Управление режимом** — команды `/observer_on` и `/observer_off` для включения/выключения активного наблюдателя.
- **Контекст** — бот помнит последние сообщения в чате (количество настраивается).
- **Подъёб** — команда `/roast @username` генерирует ироничный подкол на основе последних сообщений пользователя.
- **Анализ изображений** — отправь боту фото в личных сообщениях или тегни/ответь ему на фото в группе, и он опишет или прокомментирует картинку.

## Стек

- Node.js 18+
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- OpenRouter API (совместимый с OpenAI chat completions)

## Установка

1. Клонируй репозиторий и перейди в папку проекта:

```bash
cd bratishka-bot
npm install
```

2. Скопируй `.env.example` в `.env` и заполни переменные:

```bash
cp .env.example .env
```

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_REQUEST_TIMEOUT=30000
OBSERVER_INTERVAL=10
OBSERVER_CONTEXT_LIMIT=10
OBSERVER_MIN_INTERVAL_MS=30000
MAX_HISTORY=200
HISTORY_CONTEXT_LIMIT=30
HISTORY_SAVE_INTERVAL_MS=5000
MAX_MESSAGE_LENGTH=4096
OPENROUTER_MAX_TOKENS=4096
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=10
```

3. Запусти бота:

```bash
npm start
```

Для разработки с автоперезапуском:

```bash
npm run dev
```

## Как получить токены

### Telegram Bot Token

1. Напиши [@BotFather](https://t.me/BotFather) в Telegram.
2. Создай нового бота командой `/newbot`.
3. Скопируй полученный токен в `.env` в переменную `TELEGRAM_BOT_TOKEN`.

### OpenRouter API Key

1. Зарегистрируйся на [openrouter.ai](https://openrouter.ai/).
2. Перейди в раздел Keys и создай API-ключ.
3. Скопируй ключ в `.env` в переменную `OPENROUTER_API_KEY`.
4. Выбери модель на [странице моделей](https://openrouter.ai/models) и укажи её в `OPENROUTER_MODEL`.

## Команды

| Команда | Описание |
|---------|----------|
| `/observer_on` | Включить режим активного наблюдателя |
| `/observer_off` | Выключить режим активного наблюдателя |
| `/clear` | Очистить историю сообщений в текущем чате |
| `/roast @user [soft\|medium\|hard]` | Подъебать пользователя на основе его сообщений |
| `/personality [имя]` | Сменить личность бота в текущем чате |
| `/help` | Показать справку по командам |
| `@username ...` | Задать вопрос или попросить мнение у бота |
| **Ответить на сообщение бота** | Продолжить диалог |
| **Отправить фото** | В ЛС или с упоминанием/ответом в группе — бот проанализирует изображение |

### Как добавить команды в меню Telegram

Чтобы команды появлялись в подсказках при вводе `/`, отправь [@BotFather](https://t.me/BotFather) команду `/setcommands`, выбери своего бота и вставь содержимое файла [`botfather_commands.txt`](./botfather_commands.txt):

```text
observer_on - Включить режим активного наблюдателя
observer_off - Выключить режим активного наблюдателя
clear - Очистить историю сообщений в чате
roast - Подъебать пользователя: /roast @user [soft|medium|hard]
personality - Сменить личность бота: /personality [bratishka|gamer|dagestan]
help - Показать справку по командам
```


## Как работает режим наблюдателя

1. После включения (`/observer_on`) бот начинает считать сообщения в чате.
2. Каждые `OBSERVER_INTERVAL` сообщений (по умолчанию 10) он отправляет в OpenRouter последние `OBSERVER_CONTEXT_LIMIT` сообщений (по умолчанию 10).
3. Модель решает, есть ли смысл вмешиваться. Если да — бот пишет сообщение; если нет, отвечает внутри `SKIP` и молчит.

## Настройка

Все параметры задаются через `.env`:

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота | — |
| `OPENROUTER_API_KEY` | API-ключ OpenRouter | — |
| `OPENROUTER_MODEL` | Модель ИИ | `openai/gpt-4o-mini` |
| `OPENROUTER_BASE_URL` | Базовый URL OpenRouter API | `https://openrouter.ai/api/v1` |
| `OBSERVER_INTERVAL` | Через сколько сообщений бот анализирует чат | `10` |
| `OBSERVER_CONTEXT_LIMIT` | Сколько сообщений отправляет observer в AI | `10` |
| `OBSERVER_MIN_INTERVAL_MS` | Минимальный интервал между observer-запросами в одном чате | `30000` |
| `MAX_HISTORY` | Максимальное количество сообщений в памяти на чат | `200` |
| `HISTORY_CONTEXT_LIMIT` | Сколько сообщений отправлять ИИ при упоминании/ответе | `30` |
| `HISTORY_SAVE_INTERVAL_MS` | Интервал сохранения истории на диск | `5000` |
| `OPENROUTER_REQUEST_TIMEOUT` | Таймаут запроса к OpenRouter (мс) | `30000` |
| `MAX_MESSAGE_LENGTH` | Максимальная длина сообщения в Telegram (обрезает входящие и исходящие) | `4096` |
| `OPENROUTER_MAX_TOKENS` | Максимальное число токенов в ответе AI | `4096` |
| `RATE_LIMIT_WINDOW_MS` | Окно rate limit (мс) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Максимальное число AI-запросов от пользователя в окне | `10` |
| `VISION_MAX_IMAGE_SIZE` | Максимальный размер большей стороны фото (px) перед отправкой в AI | `1024` |
| `VISION_JPEG_QUALITY` | Качество JPEG при конвертации фото (1–100) | `80` |
| `BOT_USERNAME` | Username бота (опционально, определится автоматически) | — |
| `BOT_PERSONALITY` | Личность бота по умолчанию (`bratishka`, `gamer`, `dagestan`) | `bratishka` |
| `DEBUG` | Логирование входящих сообщений и запросов к ИИ | `false` |

## Структура проекта

```
bratishka-bot/
├── src/
│   ├── index.js       # Точка входа
│   ├── bot.js         # Логика Telegram-бота
│   ├── config.js      # Конфигурация из .env
│   ├── openrouter.js  # Клиент OpenRouter API
│   ├── history.js     # Хранение истории сообщений
│   ├── observer.js    # Состояние режима наблюдателя
│   ├── ratelimit.js   # Ограничение частоты запросов
│   ├── utils.js       # Вспомогательные функции
│   └── vision.js      # Обработка изображений
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Логирование

Если в `.env` установить `DEBUG=true`, в консоли будут видны:

- все входящие сообщения с указанием чата и отправителя;
- упоминания бота и обрабатываемые команды;
- моменты, когда активный наблюдатель анализирует чат;
- запросы к OpenRouter и полученные ответы.

Это удобно для отладки и проверки, что бот видит сообщения и реагирует на них.

## Примечания

- Бот использует long polling, поэтому для работы должен быть запущен как постоянный процесс.
- Для продакшена рекомендуется запускать через `pm2`, `systemd` или Docker.
- Состояние режима наблюдателя сохраняется в файл `observer-state.json`.
- Выбранная личность для каждого чата сохраняется в файл `personality-state.json`.
