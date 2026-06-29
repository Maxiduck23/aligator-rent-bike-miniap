# Aligator Rent CRM Mini App v0.2.7

Этот патч уточняет логику фиктивных плановых долгов аренды и ручного закрытия админом.

## Главная логика

- Смена правила оплаты удаляет только неоплаченные planned/rent_plan начисления и **никогда не создаёт client_payments**.
- Ручное закрытие плановых долгов админом теперь спрашивает:
  - создать реальную оплату (`client_payments`), или
  - закрыть только фиктивный план без оплаты.
- Дата ручной оплаты берётся из локальной даты устройства в Mini App и передаётся на сервер.
- Можно выбрать сразу несколько плановых долгов по аренде и закрыть их одним действием.

## Новая RPC

`miniapp_close_plan_charges(...)`

Параметры:

- `p_charge_ids bigint[]`
- `p_create_payment boolean`
- `p_payment_date date`
- `p_method text`
- `p_note text`
- `p_admin_tg_id bigint`

Если `p_create_payment = true`, по каждому выбранному planned charge создаётся `client_payments` и запись в `miniapp_payment_allocations`.

Если `p_create_payment = false`, charge закрывается как `[plan_closed_without_payment]`, но оплата не создаётся.

## Совместимость

Старый вызов `miniapp_close_plan_charges_without_payment(...)` оставлен как wrapper, чтобы старый API не падал.

## Важно

После замены файлов выполнить в Supabase SQL Editor:

```sql
-- весь файл
sql/001_bike_centered_miniapp.sql
```

