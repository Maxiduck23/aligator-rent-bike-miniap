# Patch for Telegram bot button

На VPS в `.env` добавь:

```bash
APP_URL="https://YOUR-VERCEL-PROJECT.vercel.app"
```

В `main.py` добавь импорт:

```python
from aiogram.types import WebAppInfo
```

В `user_keyboard(...)`, в админскую часть, добавь главную кнопку:

```python
app_url = os.getenv("APP_URL")
if app_url:
    rows.append([
        KeyboardButton(
            text="🚀 Аренда CRM",
            web_app=WebAppInfo(url=app_url.rstrip("/") + "/")
        )
    ])
```

Минимальная админская клавиатура может быть такой:

```python
if is_admin_user or role == "admin":
    rows = []
    app_url = os.getenv("APP_URL")
    if app_url:
        rows.append([
            KeyboardButton(
                text="🚀 Аренда CRM",
                web_app=WebAppInfo(url=app_url.rstrip("/") + "/")
            )
        ])
    rows += [
        [KeyboardButton(text="📊 Статистика"), KeyboardButton(text="🔄 Обновить меню")],
        [KeyboardButton(text="📚 Команды"), KeyboardButton(text="📖 Инструкция")],
    ]
```

После изменения:

```bash
python -m py_compile main.py db.py
sudo systemctl restart aligator-bot
sudo journalctl -u aligator-bot -n 100 --no-pager
```

Потом в Telegram отправь `/menu` или нажми обновление меню.
