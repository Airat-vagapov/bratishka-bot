# Деплой Bratishka Bot на VDS/VPS

Эта инструкция описывает, как задеплоить бота на сервер с Ubuntu, чтобы он работал 24/7.

## Требования к серверу

- ОС: Ubuntu 22.04 LTS (рекомендуется) или Debian 12
- Минимум: 1 CPU, 1 GB RAM, 10 GB SSD
- Если на сервере будет несколько проектов: 2 CPU, 2 GB RAM

## 1. Подключись к серверу

```bash
ssh root@IP_СЕРВЕРА
```

## 2. Обнови систему и установи базовые пакеты

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nano
```

## 3. Установи Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Проверь версии:

```bash
node -v   # должно быть v20.x.x
npm -v    # должно быть 10.x.x
```

## 4. Установи pm2

```bash
sudo npm install -g pm2
```

## 5. Закачай проект на сервер

### Вариант A: через git

```bash
cd /root
git clone https://github.com/ТВОЙ_АККАУНТ/bratishka-bot.git
cd bratishka-bot
```

### Вариант B: через scp с локальной машины

```bash
# выполняй на своём компьютере
scp -r /путь/к/bratishka-bot root@IP_СЕРВЕРА:/root/
```

Затем на сервере:

```bash
cd /root/bratishka-bot
```

## 6. Установи зависимости

```bash
npm install
```

> При установке могут появляться предупреждения об устаревших зависимостях. Перед деплоем рекомендуется запустить `npm audit` и устранить критичные уязвимости. Если `npm audit fix --force` ломает работу бота, обнови зависимость вручную и протестируй локально.

## 7. Создай файл `.env`

```bash
nano .env
```

Вставь свои данные:

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
BOT_USERNAME=
MAX_MESSAGE_LENGTH=4096
OPENROUTER_MAX_TOKENS=4096
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=10
DEBUG=false
```

Сохрани: `Ctrl+O`, `Enter`, `Ctrl+X`.

> ⚠️ Никогда не заливай `.env` в git. Он уже указан в `.gitignore`.

## 8. Запусти бота через pm2

```bash
pm2 start ecosystem.config.js
```

Или без конфига:

```bash
pm2 start src/index.js --name bratishka-bot
```

## 9. Настрой автозапуск после перезагрузки сервера

```bash
pm2 save
pm2 startup systemd
```

Последняя команда выведет длинную команду. Скопируй её и выполни. Она настроит systemd так, чтобы pm2 и все твои процессы запускались автоматически.

## 10. Проверь, что бот работает

```bash
pm2 status
```

Должно быть примерно так:

```text
┌────┬────────────────────┬──────┬─────────┬───┬──────┬───────────┐
│ id │ name               │ mode │ status  │ ↺ │ cpu  │ memory    │
├────┼────────────────────┼──────┼─────────┼───┼──────┼───────────┤
│ 0  │ bratishka-bot      │ fork │ online  │ 0 │ 0%   │ 45.2 MB   │
└────┴────────────────────┴──────┴─────────┴───┴──────┴───────────┘
```

Посмотри логи:

```bash
pm2 logs bratishka-bot
```

Проверь в Telegram:

1. Напиши `/observer_on` в группе.
2. Упомяни бота: `@твой_бот привет`.
3. Убедись, что он отвечает.

## 11. Полезные команды pm2

```bash
pm2 logs bratishka-bot              # смотреть логи
pm2 logs bratishka-bot --lines 100  # последние 100 строк
pm2 restart bratishka-bot           # перезапустить
pm2 stop bratishka-bot              # остановить
pm2 delete bratishka-bot            # удалить процесс из pm2
pm2 monit                           # мониторинг в реальном времени
pm2 list                            # список всех процессов
```

## 12. Как обновить бота

Если ты внёс изменения в код локально и залил в git:

```bash
cd /root/bratishka-bot
git pull
npm install
pm2 restart bratishka-bot
```

Если переносил через scp — просто скопируй файлы заново и перезапусти:

```bash
pm2 restart bratishka-bot
```

## Возможные проблемы

### Бот не отвечает в группе

Проверь, что в [@BotFather](https://t.me/BotFather) для бота отключён **Group Privacy**:

```
Bot Settings → Group Privacy → Turn off
```

После этого удали бота из группы и добавь заново.

### Ошибка `ETELEGRAM: 409 Conflict`

Это значит, что бот уже запущен где-то ещё (например, локально на твоём компьютере). Останови локальный процесс, прежде чем запускать на сервере.

### pm2 не запускается после перезагрузки

Убедись, что выполнил команду, которую выдала `pm2 startup systemd`. Она обычно выглядит так:

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root
```

Затем:

```bash
pm2 save
```
