# v0.2.7 SQLFIX

Исправляет ошибку Supabase/Postgres:

```
ERROR: 42P16: cannot change name of view column "charge_type" to "category"
```

Причина: `CREATE OR REPLACE VIEW miniapp_debt_items` не может переименовать/переставить уже существующую колонку view.
В этой версии новые поля `category`, `category_label`, `charge_origin`, `period_start` добавлены в конец view, поэтому SQL можно запускать поверх старой базы.

Деплой: вставь целиком `sql/001_bike_centered_miniapp.sql` в Supabase SQL Editor и запусти.
