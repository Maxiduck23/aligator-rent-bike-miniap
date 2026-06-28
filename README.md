# Aligator Rent Bike Mini App v0.2

Bike-centered Telegram Mini App for Vercel + Supabase.

Главная логика: админ выбирает `bike_id`, а приложение само подтягивает active-аренду, клиента, долги, правила оплаты, батареи и Telegram-привязку.

## MVP функции

- 🚲 Велики: список из БД, поиск по ID/модели, карточка велика.
- ⚠️ Долги: выбор всех долгов галочками, снятие галочки с исключений.
- 🙈 Исключения долгов: безопасно скрывает ошибочные/дублирующиеся долги только в Mini App через `miniapp_debt_exclusions`.
- ✅ Оплачено: bulk mark paid выбранных начислений с записью в `client_payments`.
- 📢 Напоминания: отправка Telegram-сообщений выбранным клиентам, если Telegram привязан.
- ⚙️ Правило оплаты: 1/2/4 части или любой график до 12 частей.
- 📄 Аренды: новая аренда, закрытие active-аренды, новый договор/переоформление по bike_id.
- 🔑 Клиенты: создать клиента, создать invite-key для нового/старого клиента, привязать Telegram ID.
- 🚨 Исключения: экран предупреждений, где учёт может врать.

## 1. Supabase SQL

В Supabase SQL Editor выполни:

```text
sql/001_bike_centered_miniapp.sql
```

SQL создаёт:

- `miniapp_debt_exclusions`
- `miniapp_clients`
- `miniapp_active_rentals`
- `miniapp_batteries`
- `miniapp_debt_items`
- `miniapp_payment_rules`
- `miniapp_bike_cards`
- `miniapp_exceptions`
- RPC функции для оплаты, исключений, аренды, payment rule, клиентов, Telegram link.

## 2. Local dev

```bash
npm install
cp .env.example .env.local
npm run dev
```

Для локального теста без Telegram:

```bash
AUTH_DEV_MODE="1"
DEV_TELEGRAM_ID="твой_admin_telegram_id"
ADMIN_IDS="твой_admin_telegram_id"
```

В production обязательно:

```bash
AUTH_DEV_MODE="0"
```

## 3. Vercel env variables

В Vercel → Project → Settings → Environment Variables:

```bash
NEXT_PUBLIC_APP_NAME="Aligator Rent CRM"
SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
TELEGRAM_BOT_TOKEN="123456:ABCDEF"
TELEGRAM_BOT_USERNAME="aligator_bike_bot"
ADMIN_IDS="123456789,987654321"
AUTH_DEV_MODE="0"
```

`SUPABASE_SERVICE_ROLE_KEY` никогда не должен попадать в браузер. Он используется только в server API routes.

## 4. Telegram bot button

В aiogram боте добавь кнопку WebApp. Смотри `BOT_PATCH.md`.

## 5. Security model

- Все `/api/admin/*` routes проверяют Telegram `initData`.
- После проверки Telegram ID сверяется с `ADMIN_IDS`.
- Supabase service role key хранится только на серверной стороне Vercel.
- Включены базовые security headers в `next.config.ts`.
- Изменения пишутся через RPC и audit helper `miniapp_audit`.
- Долги по умолчанию не удаляются: исключения пишутся в `miniapp_debt_exclusions`, чтобы не портить историю.

## 6. Важная логика долгов

В разделе “Долги” все открытые начисления выбираются галочками. Можно:

- снять галочку с тех, кого не трогать;
- отправить напоминание выбранным;
- отметить выбранные как оплаченные;
- исключить выбранные из Mini App списка как дубль/ошибку.

Исключение не меняет `client_charges.status`, поэтому это безопаснее, чем удалять или отменять начисление.

## 7. Что делать после первого deploy

1. Открыть Mini App из Telegram.
2. Проверить экран `🚨 Исключения`.
3. Исправить critical: rented без active rental, multiple active rentals.
4. В карточках active-великов создать payment rules.
5. По долгам выбрать реальные долги, лишние исключить.
