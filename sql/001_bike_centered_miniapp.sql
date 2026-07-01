-- Aligator Rent CRM Mini App v0.3.3 BIKE HEALTH
-- Bike-centered admin Mini App for Vercel.
-- Run in Supabase SQL Editor.
-- This migration adds views, RPC helpers, and a safe miniapp-only exclusions table.

-- Safe view rebuild: PostgreSQL cannot CREATE OR REPLACE when a column was inserted
-- in the middle of an existing view. We drop Mini App views only; real tables stay safe.
DROP VIEW IF EXISTS public.miniapp_bike_health_summary CASCADE;
DROP VIEW IF EXISTS public.miniapp_bike_battery_health CASCADE;
DROP VIEW IF EXISTS public.miniapp_bike_notifications CASCADE;
DROP VIEW IF EXISTS public.miniapp_client_health_bikes CASCADE;
DROP VIEW IF EXISTS public.miniapp_client_category_balances CASCADE;
DROP VIEW IF EXISTS public.miniapp_client_balance_summary CASCADE;
DROP VIEW IF EXISTS public.miniapp_payment_allocations_view CASCADE;
DROP VIEW IF EXISTS public.miniapp_client_auth_map CASCADE;
DROP VIEW IF EXISTS public.miniapp_exceptions CASCADE;
DROP VIEW IF EXISTS public.miniapp_bike_cards CASCADE;
DROP VIEW IF EXISTS public.miniapp_payment_rules CASCADE;
DROP VIEW IF EXISTS public.miniapp_debt_items CASCADE;
DROP VIEW IF EXISTS public.miniapp_batteries CASCADE;
DROP VIEW IF EXISTS public.miniapp_active_rentals CASCADE;
DROP VIEW IF EXISTS public.miniapp_clients CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- MiniApp-only exclusions: safe alternative to deleting/cancelling old charges.
-- Excluded charges are hidden in Mini App debt screen, but raw client_charges stays unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS miniapp_debt_exclusions (
  charge_id bigint PRIMARY KEY REFERENCES client_charges(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'excluded from Mini App',
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- Client contract fields used by admin/client registration forms.
-- Existing DB exports already contained most of these columns, but keeping
-- ALTER IF NOT EXISTS makes this SQL safe for older projects too.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'ID card';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS doc_number text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tg_registered_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW miniapp_clients AS
SELECT
  c.id,
  c.name,
  c.phone,
  c.email,
  c.address,
  c.doc_type,
  c.doc_number,
  c.telegram_id,
  c.payment_status,
  c.notes,
  COALESCE(COUNT(r.id) FILTER (WHERE r.status = 'active'), 0)::int AS active_rentals,
  COALESCE(array_agg(r.bike_id ORDER BY r.bike_id) FILTER (WHERE r.status = 'active'), ARRAY[]::bigint[]) AS active_bike_ids
FROM clients c
LEFT JOIN rentals r ON r.client_id = c.id
GROUP BY c.id, c.name, c.phone, c.email, c.address, c.doc_type, c.doc_number, c.telegram_id, c.payment_status, c.notes;

CREATE OR REPLACE VIEW miniapp_active_rentals AS
SELECT
  r.id,
  r.bike_id,
  r.client_id,
  c.name AS client_name,
  c.phone AS client_phone,
  c.telegram_id AS client_telegram_id,
  tu.telegram_id AS private_telegram_id,
  r.price,
  r.start_date,
  r.end_date,
  r.status,
  r.deposit,
  r.charger_quantity,
  r.rental_type,
  r.notes,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label
FROM rentals r
JOIN clients c ON c.id = r.client_id
LEFT JOIN telegram_users tu ON tu.client_id = c.id AND tu.has_private_chat = true
LEFT JOIN bikes b ON b.id = r.bike_id
WHERE r.status = 'active'
ORDER BY r.id DESC;

CREATE OR REPLACE VIEW miniapp_batteries AS
SELECT
  bat.id,
  bat.bike_id,
  bat.status,
  bat.notes,
  bt.brand,
  bt.compatible_bike_model,
  bt.capacity,
  bt.generation
FROM batteries bat
LEFT JOIN battery_types bt ON bt.id = bat.type_id;

CREATE OR REPLACE VIEW miniapp_debt_items AS
SELECT
  ch.id AS charge_id,
  ch.client_id,
  c.name AS client_name,
  c.phone AS client_phone,
  c.telegram_id AS client_telegram_id,
  tu.telegram_id AS private_telegram_id,
  ch.rental_id,
  COALESCE(ch.bike_id, r.bike_id) AS bike_id,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  ch.charge_type,
  ch.amount,
  ch.paid_amount,
  (ch.amount - ch.paid_amount)::numeric AS debt_left,
  ch.due_date,
  ch.status,
  ch.notes,
  ch.client_note,
  ch.admin_note,
  ch.promised_date,
  ch.reminder_paused_until,
  ch.created_at,
  (ex.charge_id IS NOT NULL) AS is_excluded,
  ex.reason AS exclusion_reason,
  GREATEST((CURRENT_DATE - ch.due_date), 0)::int AS overdue_days
FROM client_charges ch
JOIN clients c ON c.id = ch.client_id
LEFT JOIN rentals r ON r.id = ch.rental_id
LEFT JOIN bikes b ON b.id = COALESCE(ch.bike_id, r.bike_id)
LEFT JOIN telegram_users tu ON tu.client_id = c.id AND tu.has_private_chat = true
LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
WHERE ch.status IN ('due', 'partial')
  AND ch.amount > ch.paid_amount;

CREATE OR REPLACE VIEW miniapp_payment_rules AS
SELECT
  pr.id,
  pr.client_id,
  c.name AS client_name,
  pr.rental_id,
  r.bike_id,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  pr.is_active,
  pr.weekly_amount,
  pr.monthly_amount,
  pr.period_type,
  pr.min_period_amount,
  pr.admin_only,
  pr.remind_client,
  pr.remind_admin,
  pr.grace_days,
  pr.allow_client_edit,
  pr.requires_admin_approval,
  pr.notes,
  pr.created_at,
  pr.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', prp.id,
        'part_number', prp.part_number,
        'due_day', prp.due_day,
        'amount', prp.amount
      ) ORDER BY prp.part_number
    ) FILTER (WHERE prp.id IS NOT NULL),
    '[]'::jsonb
  ) AS parts
FROM payment_rules pr
JOIN clients c ON c.id = pr.client_id
LEFT JOIN rentals r ON r.id = pr.rental_id
LEFT JOIN bikes b ON b.id = r.bike_id
LEFT JOIN payment_rule_parts prp ON prp.rule_id = pr.id
GROUP BY pr.id, c.name, r.bike_id, b.id, b.brand, b.model;

CREATE OR REPLACE VIEW miniapp_bike_cards AS
WITH active_r AS (
  SELECT DISTINCT ON (bike_id)
    r.*,
    c.name AS client_name,
    c.phone AS client_phone,
    c.telegram_id AS client_telegram_id,
    tu.telegram_id AS private_telegram_id
  FROM rentals r
  JOIN clients c ON c.id = r.client_id
  LEFT JOIN telegram_users tu ON tu.client_id = c.id AND tu.has_private_chat = true
  WHERE r.status = 'active'
  ORDER BY bike_id, r.id DESC
), debts AS (
  SELECT
    COALESCE(ch.bike_id, r.bike_id) AS bike_id,
    COUNT(*) FILTER (WHERE ex.charge_id IS NULL)::int AS open_debts,
    COALESCE(SUM(ch.amount - ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL), 0)::numeric AS debt_total,
    COALESCE(MAX(CURRENT_DATE - ch.due_date) FILTER (WHERE ch.due_date < CURRENT_DATE AND ex.charge_id IS NULL), 0)::int AS max_overdue_days
  FROM client_charges ch
  LEFT JOIN rentals r ON r.id = ch.rental_id
  LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
  WHERE ch.status IN ('due','partial') AND ch.amount > ch.paid_amount
  GROUP BY COALESCE(ch.bike_id, r.bike_id)
), rules AS (
  SELECT rental_id, COUNT(*) FILTER (WHERE is_active = true)::int AS active_rules
  FROM payment_rules
  GROUP BY rental_id
), batteries_count AS (
  SELECT bike_id, COUNT(*)::int AS batteries_count
  FROM batteries
  WHERE bike_id IS NOT NULL
  GROUP BY bike_id
)
SELECT
  b.id,
  b.brand,
  b.model,
  b.status,
  b.notes,
  b.updated_at,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  ar.id AS active_rental_id,
  ar.client_id AS active_client_id,
  ar.client_name,
  ar.client_phone,
  ar.client_telegram_id,
  ar.private_telegram_id,
  ar.price AS active_price,
  ar.start_date AS active_start_date,
  ar.deposit AS active_deposit,
  ar.charger_quantity AS active_charger_quantity,
  COALESCE(d.open_debts, 0)::int AS open_debts,
  COALESCE(d.debt_total, 0)::numeric AS debt_total,
  COALESCE(d.max_overdue_days, 0)::int AS max_overdue_days,
  COALESCE(rules.active_rules, 0)::int AS active_payment_rules,
  COALESCE(bc.batteries_count, 0)::int AS batteries_count,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN b.status = 'rented' AND ar.id IS NULL THEN 'bike_rented_without_active_rental' END,
    CASE WHEN ar.id IS NOT NULL AND b.status IS DISTINCT FROM 'rented' THEN 'active_rental_but_bike_not_rented' END,
    CASE WHEN ar.id IS NOT NULL AND COALESCE(ar.private_telegram_id, ar.client_telegram_id) IS NULL THEN 'active_client_without_telegram' END,
    CASE WHEN ar.id IS NOT NULL AND COALESCE(rules.active_rules, 0) = 0 THEN 'active_rental_without_payment_rule' END,
    CASE WHEN COALESCE(d.open_debts, 0) > 0 AND COALESCE(d.max_overdue_days, 0) > 0 THEN 'overdue_debt' END
  ], NULL) AS warnings
FROM bikes b
LEFT JOIN active_r ar ON ar.bike_id = b.id
LEFT JOIN debts d ON d.bike_id = b.id
LEFT JOIN rules ON rules.rental_id = ar.id
LEFT JOIN batteries_count bc ON bc.bike_id = b.id;

CREATE OR REPLACE VIEW miniapp_exceptions AS
SELECT
  'critical'::text AS severity,
  'bike_rented_without_active_rental'::text AS exception_type,
  b.id::bigint AS entity_id,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS title,
  'Велик имеет status=rented, но active-аренда не найдена.'::text AS description
FROM bikes b
WHERE b.status = 'rented'
  AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.bike_id = b.id AND r.status = 'active')
UNION ALL
SELECT
  'critical',
  'multiple_active_rentals_same_bike',
  r.bike_id::bigint,
  '#' || r.bike_id::text,
  'У одного велика больше одной active-аренды: ' || COUNT(*)::text
FROM rentals r
WHERE r.status = 'active'
GROUP BY r.bike_id
HAVING COUNT(*) > 1
UNION ALL
SELECT
  'warning',
  'active_rental_but_bike_not_rented',
  r.bike_id::bigint,
  '#' || r.bike_id::text,
  'Есть active-аренда, но bike.status не rented.'
FROM rentals r
JOIN bikes b ON b.id = r.bike_id
WHERE r.status = 'active' AND b.status IS DISTINCT FROM 'rented'
UNION ALL
SELECT
  'warning',
  'active_client_without_telegram',
  r.id::bigint,
  'Аренда #' || r.id::text || ' / велик #' || r.bike_id::text,
  'Клиент ' || c.name || ' не привязан к Telegram, напоминания не дойдут.'
FROM rentals r
JOIN clients c ON c.id = r.client_id
LEFT JOIN telegram_users tu ON tu.client_id = c.id AND tu.has_private_chat = true
WHERE r.status = 'active'
  AND COALESCE(tu.telegram_id, c.telegram_id) IS NULL
UNION ALL
SELECT
  'warning',
  'active_rental_without_payment_rule',
  r.id::bigint,
  'Аренда #' || r.id::text || ' / велик #' || r.bike_id::text,
  'У active-аренды нет active payment_rule.'
FROM rentals r
WHERE r.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM payment_rules pr WHERE pr.rental_id = r.id AND pr.is_active = true)
UNION ALL
SELECT
  'warning',
  'possible_duplicate_open_charge',
  MIN(ch.id)::bigint,
  'Клиент #' || ch.client_id::text || ' / дата ' || ch.due_date::text,
  'Возможный дубль начислений: ' || COUNT(*)::text || ' шт. Проверь долги.'
FROM client_charges ch
WHERE ch.status IN ('due','partial') AND ch.amount > ch.paid_amount
GROUP BY ch.client_id, ch.rental_id, ch.bike_id, ch.charge_type, ch.amount, ch.due_date
HAVING COUNT(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers / RPC
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION miniapp_audit(p_admin_tg_id bigint, p_action text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF to_regclass('public.bot_audit_log') IS NOT NULL THEN
    INSERT INTO bot_audit_log (telegram_id, action, details)
    VALUES (p_admin_tg_id, p_action, p_details);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_link_telegram(
  p_client_id int,
  p_telegram_id bigint,
  p_username text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conflict bigint;
BEGIN
  SELECT id INTO v_conflict FROM clients WHERE telegram_id = p_telegram_id AND id <> p_client_id LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Telegram ID уже привязан к другому клиенту #%.' , v_conflict;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Клиент #% не найден.', p_client_id;
  END IF;

  UPDATE clients
  SET telegram_id = p_telegram_id,
      tg_registered_at = COALESCE(tg_registered_at, now())
  WHERE id = p_client_id;

  INSERT INTO telegram_users (telegram_id, username, role, client_id, has_private_chat, updated_at)
  VALUES (p_telegram_id, p_username, 'client', p_client_id, false, now())
  ON CONFLICT (telegram_id) DO UPDATE SET
    username = COALESCE(EXCLUDED.username, telegram_users.username),
    role = CASE WHEN telegram_users.role = 'admin' THEN 'admin' ELSE 'client' END,
    client_id = EXCLUDED.client_id,
    updated_at = now();

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_link_telegram', jsonb_build_object('client_id', p_client_id, 'telegram_id', p_telegram_id));

  RETURN jsonb_build_object('client_id', p_client_id, 'telegram_id', p_telegram_id);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_create_client(
  p_name text,
  p_phone text DEFAULT NULL,
  p_telegram_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_doc_type text DEFAULT NULL,
  p_doc_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client clients%ROWTYPE;
BEGIN
  IF trim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Имя клиента обязательно.';
  END IF;

  INSERT INTO clients (name, phone, email, address, doc_type, doc_number, telegram_id, notes, payment_status, created_at, tg_registered_at)
  VALUES (
    p_name,
    p_phone,
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(trim(COALESCE(p_address, '')), ''),
    COALESCE(NULLIF(trim(COALESCE(p_doc_type, '')), ''), 'ID card'),
    NULLIF(trim(COALESCE(p_doc_number, '')), ''),
    p_telegram_id,
    p_notes,
    'ok',
    now(),
    CASE WHEN p_telegram_id IS NULL THEN NULL ELSE now() END
  )
  RETURNING * INTO v_client;

  IF p_telegram_id IS NOT NULL THEN
    PERFORM miniapp_link_telegram(v_client.id::int, p_telegram_id, NULL, p_admin_tg_id);
  END IF;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_create_client', jsonb_build_object('client_id', v_client.id, 'name', v_client.name));
  RETURN to_jsonb(v_client);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_exclude_charges(
  p_charge_ids bigint[],
  p_reason text,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO miniapp_debt_exclusions (charge_id, reason, created_by_telegram_id)
  SELECT DISTINCT x, COALESCE(NULLIF(trim(p_reason), ''), 'excluded from Mini App'), p_admin_tg_id
  FROM unnest(p_charge_ids) AS x
  ON CONFLICT (charge_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    created_by_telegram_id = EXCLUDED.created_by_telegram_id,
    created_at = now();

  -- v0.3.7: исключение = списать/убрать из напоминаний, а не только скрыть из Mini App.
  -- Реальная запись остаётся в client_charges для истории, но больше не считается активным долгом.
  UPDATE client_charges ch
  SET status = 'excluded',
      remind_client = false,
      remind_admin = false,
      updated_at = now(),
      notes = trim(both E'\n' from concat_ws(E'\n', ch.notes, '[excluded] ' || COALESCE(NULLIF(trim(p_reason), ''), 'excluded from Mini App')))
  WHERE ch.id = ANY(p_charge_ids)
    AND ch.status IN ('due','partial');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_exclude_charges', jsonb_build_object('charge_ids', p_charge_ids, 'reason', p_reason, 'status_set', 'excluded'));
  RETURN jsonb_build_object('excluded_count', v_count, 'charge_ids', p_charge_ids, 'status', 'excluded');
END;
$$;


-- v0.3.7: применить новую логику к уже существующим исключениям.
UPDATE client_charges ch
SET status = 'excluded',
    remind_client = false,
    remind_admin = false,
    updated_at = now(),
    notes = trim(both E'\n' from concat_ws(E'\n', ch.notes, '[excluded] migrated from miniapp_debt_exclusions'))
FROM miniapp_debt_exclusions ex
WHERE ex.charge_id = ch.id
  AND ch.status IN ('due','partial');

CREATE OR REPLACE FUNCTION miniapp_mark_charges_paid(
  p_charge_ids bigint[],
  p_method text DEFAULT 'manual',
  p_note text DEFAULT 'marked paid from miniapp',
  p_payment_date date DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ch record;
  v_payment_id bigint;
  v_paid_ids bigint[] := ARRAY[]::bigint[];
  v_amount numeric;
BEGIN
  FOR ch IN
    SELECT * FROM client_charges
    WHERE id = ANY(p_charge_ids)
      AND status IN ('due','partial')
      AND amount > paid_amount
    ORDER BY id
    FOR UPDATE
  LOOP
    v_amount := ch.amount - ch.paid_amount;

    INSERT INTO client_payments (client_id, rental_id, charge_id, amount, payment_date, method, notes, created_by_telegram_id, created_at)
    VALUES (ch.client_id, ch.rental_id, ch.id, v_amount, COALESCE(p_payment_date, CURRENT_DATE), p_method, p_note, p_admin_tg_id, now())
    RETURNING id INTO v_payment_id;

    UPDATE client_charges
    SET paid_amount = amount,
        status = 'paid',
        paid_at = now(),
        updated_at = now(),
        notes = trim(both E'\n' from concat_ws(E'\n', notes, 'paid_from_miniapp payment_id=' || v_payment_id::text))
    WHERE id = ch.id;

    v_paid_ids := array_append(v_paid_ids, ch.id);
  END LOOP;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_mark_charges_paid', jsonb_build_object('charge_ids', p_charge_ids, 'paid_ids', v_paid_ids));
  RETURN jsonb_build_object('paid_ids', v_paid_ids);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_set_payment_rule_by_bike(
  p_bike_id int,
  p_monthly_amount numeric,
  p_parts jsonb,
  p_grace_days int DEFAULT 0,
  p_admin_only boolean DEFAULT false,
  p_allow_client_edit boolean DEFAULT false,
  p_requires_admin_approval boolean DEFAULT false,
  p_note text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental rentals%ROWTYPE;
  v_rule payment_rules%ROWTYPE;
  v_part jsonb;
  v_part_number int := 0;
  v_due_day int;
  v_amount numeric;
  v_sum numeric := 0;
  v_days int[] := ARRAY[]::int[];
  v_deleted_planned_count int := 0;
BEGIN
  SELECT * INTO v_rental
  FROM rentals
  WHERE bike_id = p_bike_id AND status = 'active'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У велика #% нет active-аренды.', p_bike_id;
  END IF;

  IF p_monthly_amount <= 0 THEN
    RAISE EXCEPTION 'monthly_amount должен быть больше 0.';
  END IF;

  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'parts должен быть непустым массивом.';
  END IF;

  IF jsonb_array_length(p_parts) > 12 THEN
    RAISE EXCEPTION 'Максимум 12 частей оплаты.';
  END IF;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    v_due_day := (v_part->>'due_day')::int;
    v_amount := (v_part->>'amount')::numeric;
    IF v_due_day < 1 OR v_due_day > 31 THEN
      RAISE EXCEPTION 'День оплаты должен быть 1-31.';
    END IF;
    IF v_due_day = ANY(v_days) THEN
      RAISE EXCEPTION 'День оплаты % повторяется.', v_due_day;
    END IF;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Сумма части должна быть больше 0.';
    END IF;
    v_days := array_append(v_days, v_due_day);
    v_sum := v_sum + v_amount;
  END LOOP;

  IF v_sum < p_monthly_amount THEN
    RAISE EXCEPTION 'Сумма частей меньше месячной суммы: нужно %, указано %.', p_monthly_amount, v_sum;
  END IF;

  -- При смене правила удаляем только НЕОПЛАЧЕННЫЕ фиктивные rent_plan-долги этой active-аренды.
  -- Реальные долги, ремонты, депозиты и уже закрытые плановые строки не трогаем.
  DELETE FROM client_charges ch
  WHERE ch.rental_id = v_rental.id
    AND ch.status = 'due'
    AND COALESCE(ch.paid_amount, 0) = 0
    AND miniapp_charge_origin(ch.charge_type, ch.notes) = 'planned';
  GET DIAGNOSTICS v_deleted_planned_count = ROW_COUNT;

  UPDATE payment_rules
  SET is_active = false,
      updated_at = now(),
      notes = trim(both E'\n' from concat_ws(E'\n', notes, 'disabled_by_miniapp_new_rule'))
  WHERE rental_id = v_rental.id AND is_active = true;

  INSERT INTO payment_rules (
    client_id, rental_id, is_active, weekly_amount, split_mode,
    remind_client, remind_admin, admin_only, grace_days, notes,
    monthly_amount, period_type, min_period_amount,
    allow_client_edit, requires_admin_approval, created_at
  )
  VALUES (
    v_rental.client_id, v_rental.id, true, p_monthly_amount, 'monthly_parts',
    true, true, p_admin_only, COALESCE(p_grace_days, 0), p_note,
    p_monthly_amount, 'monthly', p_monthly_amount,
    p_allow_client_edit, p_requires_admin_approval, now()
  )
  RETURNING * INTO v_rule;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    v_part_number := v_part_number + 1;
    INSERT INTO payment_rule_parts (rule_id, part_number, due_day, amount)
    VALUES (v_rule.id, v_part_number, (v_part->>'due_day')::int, (v_part->>'amount')::numeric);
  END LOOP;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_set_payment_rule_by_bike', jsonb_build_object('bike_id', p_bike_id, 'rental_id', v_rental.id, 'rule_id', v_rule.id));
  RETURN jsonb_build_object('rule_id', v_rule.id, 'rental_id', v_rental.id, 'bike_id', p_bike_id, 'sum_parts', v_sum, 'deleted_unpaid_planned_charges', v_deleted_planned_count);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_create_rental(
  p_bike_id int,
  p_client_id int,
  p_price numeric,
  p_start_date date DEFAULT CURRENT_DATE,
  p_deposit numeric DEFAULT 0,
  p_charger_quantity int DEFAULT 1,
  p_rental_type text DEFAULT 'monthly',
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental rentals%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM rentals WHERE bike_id = p_bike_id AND status='active') THEN
    RAISE EXCEPTION 'У велика #% уже есть active-аренда.', p_bike_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bikes WHERE id = p_bike_id) THEN
    RAISE EXCEPTION 'Велик #% не найден.', p_bike_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Клиент #% не найден.', p_client_id;
  END IF;
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'Цена аренды должна быть больше 0.';
  END IF;

  INSERT INTO rentals (bike_id, client_id, price, start_date, end_date, status, created_by, notes, created_at, rental_type, deposit, charger_quantity)
  VALUES (p_bike_id, p_client_id, p_price, p_start_date, NULL, 'active', NULL, p_notes, now(), p_rental_type, COALESCE(p_deposit,0), COALESCE(p_charger_quantity,1))
  RETURNING * INTO v_rental;

  UPDATE bikes SET status='rented', updated_at=now() WHERE id=p_bike_id;
  UPDATE batteries SET status='rented' WHERE bike_id=p_bike_id;

  INSERT INTO battery_rentals (rental_id, battery_id, status, created_at)
  SELECT v_rental.id, b.id, 'active', now()
  FROM batteries b
  WHERE b.bike_id = p_bike_id
  ON CONFLICT DO NOTHING;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_create_rental', jsonb_build_object('rental_id', v_rental.id, 'bike_id', p_bike_id, 'client_id', p_client_id));
  RETURN to_jsonb(v_rental);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_close_rental_by_bike(
  p_bike_id int,
  p_end_date date DEFAULT CURRENT_DATE,
  p_bike_status text DEFAULT 'free',
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_rental
  FROM rentals
  WHERE bike_id=p_bike_id AND status='active'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У велика #% нет active-аренды.', p_bike_id;
  END IF;

  UPDATE rentals
  SET status='closed',
      end_date=p_end_date,
      notes=trim(both E'\n' from concat_ws(E'\n', notes, p_notes, 'closed_from_miniapp'))
  WHERE id=v_rental.id
  RETURNING * INTO v_rental;

  UPDATE payment_rules SET is_active=false, updated_at=now() WHERE rental_id=v_rental.id AND is_active=true;
  UPDATE battery_rentals SET status='closed', returned_at=now(), notes=trim(both E'\n' from concat_ws(E'\n', notes, 'closed_from_miniapp')) WHERE rental_id=v_rental.id AND status='active';
  UPDATE bikes SET status=p_bike_status, updated_at=now() WHERE id=p_bike_id;
  UPDATE batteries SET status=CASE WHEN p_bike_status='rented' THEN 'rented' ELSE 'free' END WHERE bike_id=p_bike_id;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_close_rental_by_bike', jsonb_build_object('rental_id', v_rental.id, 'bike_id', p_bike_id, 'bike_status', p_bike_status));
  RETURN to_jsonb(v_rental);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_replace_rental_by_bike(
  p_bike_id int,
  p_new_client_id int,
  p_price numeric,
  p_start_date date DEFAULT CURRENT_DATE,
  p_deposit numeric DEFAULT 0,
  p_charger_quantity int DEFAULT 1,
  p_rental_type text DEFAULT 'monthly',
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old rentals%ROWTYPE;
  v_new rentals%ROWTYPE;
  v_old_end date;
BEGIN
  SELECT * INTO v_old
  FROM rentals
  WHERE bike_id=p_bike_id AND status='active'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У велика #% нет active-аренды для переоформления.', p_bike_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id=p_new_client_id) THEN
    RAISE EXCEPTION 'Новый клиент #% не найден.', p_new_client_id;
  END IF;
  IF v_old.client_id = p_new_client_id THEN
    RAISE EXCEPTION 'Новый клиент совпадает со старым.';
  END IF;

  v_old_end := p_start_date - INTERVAL '1 day';

  UPDATE rentals
  SET status='closed',
      end_date=v_old_end,
      notes=trim(both E'\n' from concat_ws(E'\n', notes, 'replaced_from_miniapp: ' || COALESCE(p_notes,'')))
  WHERE id=v_old.id;

  UPDATE payment_rules SET is_active=false, updated_at=now() WHERE rental_id=v_old.id AND is_active=true;
  UPDATE battery_rentals SET status='closed', returned_at=now(), notes=trim(both E'\n' from concat_ws(E'\n', notes, 'replaced_from_miniapp')) WHERE rental_id=v_old.id AND status='active';

  INSERT INTO rentals (bike_id, client_id, price, start_date, end_date, status, created_by, notes, created_at, rental_type, deposit, charger_quantity)
  VALUES (p_bike_id, p_new_client_id, p_price, p_start_date, NULL, 'active', NULL, p_notes, now(), p_rental_type, COALESCE(p_deposit,0), COALESCE(p_charger_quantity,1))
  RETURNING * INTO v_new;

  UPDATE bikes SET status='rented', updated_at=now() WHERE id=p_bike_id;
  UPDATE batteries SET status='rented' WHERE bike_id=p_bike_id;

  INSERT INTO battery_rentals (rental_id, battery_id, status, created_at)
  SELECT v_new.id, b.id, 'active', now()
  FROM batteries b
  WHERE b.bike_id=p_bike_id
  ON CONFLICT DO NOTHING;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_replace_rental_by_bike', jsonb_build_object('old_rental_id', v_old.id, 'new_rental_id', v_new.id, 'bike_id', p_bike_id, 'new_client_id', p_new_client_id));

  RETURN jsonb_build_object('old_rental_id', v_old.id, 'new_rental_id', v_new.id, 'bike_id', p_bike_id);
END;
$$;

-- v0.2.4: Generate manual rent charges for one bike and one concrete month.
-- This is the temporary bridge before Fio API: rules create planned charges, admin marks real payments manually.
CREATE OR REPLACE FUNCTION miniapp_generate_month_charges_by_bike(
  p_bike_id int,
  p_year int,
  p_month int,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental rentals%ROWTYPE;
  v_rule payment_rules%ROWTYPE;
  v_part payment_rule_parts%ROWTYPE;
  v_period_start date;
  v_period_end date;
  v_last_day int;
  v_due_date date;
  v_created_count int := 0;
  v_existing_count int := 0;
  v_due_dates text[] := ARRAY[]::text[];
BEGIN
  IF p_year < 2020 OR p_year > 2100 THEN
    RAISE EXCEPTION 'year must be 2020-2100';
  END IF;
  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'month must be 1-12';
  END IF;

  v_period_start := make_date(p_year, p_month, 1);
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  v_last_day := extract(day from v_period_end)::int;

  SELECT * INTO v_rental
  FROM rentals
  WHERE bike_id = p_bike_id AND status = 'active'
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У велика #% нет active-аренды.', p_bike_id;
  END IF;

  SELECT * INTO v_rule
  FROM payment_rules
  WHERE rental_id = v_rental.id AND is_active = true
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У active-аренды #% нет active payment rule.', v_rental.id;
  END IF;

  FOR v_part IN
    SELECT * FROM payment_rule_parts WHERE rule_id = v_rule.id ORDER BY part_number, due_day
  LOOP
    v_due_date := make_date(p_year, p_month, LEAST(v_part.due_day, v_last_day));
    v_due_dates := array_append(v_due_dates, v_due_date::text);

    IF EXISTS (
      SELECT 1 FROM client_charges ch
      WHERE ch.rental_id = v_rental.id
        AND ch.client_id = v_rental.client_id
        AND COALESCE(ch.bike_id, p_bike_id) = p_bike_id
        AND miniapp_charge_origin(ch.charge_type, ch.notes) = 'planned'
        AND ch.due_date = v_due_date
        AND ch.amount = v_part.amount
        AND COALESCE(ch.period_start, v_period_start) = v_period_start
        AND COALESCE(ch.period_end, v_period_end) = v_period_end
    ) THEN
      v_existing_count := v_existing_count + 1;
    ELSE
      INSERT INTO client_charges (
        client_id, rental_id, bike_id, charge_type, amount, due_date,
        status, paid_amount, notes, period_start, period_end
      ) VALUES (
        v_rental.client_id, v_rental.id, p_bike_id, 'rent_plan', v_part.amount, v_due_date,
        'due', 0,
        concat('[miniapp_plan] generated_by_rule #', v_rule.id, '; due_day=', v_part.due_day, '; month=', p_year, '-', lpad(p_month::text, 2, '0')),
        v_period_start, v_period_end
      );
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  PERFORM miniapp_audit(
    p_admin_tg_id,
    'miniapp_generate_month_charges_by_bike',
    jsonb_build_object('bike_id', p_bike_id, 'rental_id', v_rental.id, 'rule_id', v_rule.id, 'year', p_year, 'month', p_month, 'created_count', v_created_count, 'existing_count', v_existing_count)
  );

  RETURN jsonb_build_object(
    'bike_id', p_bike_id,
    'rental_id', v_rental.id,
    'rule_id', v_rule.id,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'created_count', v_created_count,
    'existing_count', v_existing_count,
    'due_dates', v_due_dates
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- v0.2.5: client balance ledger, charge categories, manual payments,
-- payment allocations, and client-side payment rule change requests.
-- This is intentionally additive: it does not delete old bot data.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS miniapp_payment_allocations (
  id bigserial PRIMARY KEY,
  payment_id bigint NOT NULL REFERENCES client_payments(id) ON DELETE CASCADE,
  charge_id bigint NOT NULL REFERENCES client_charges(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, charge_id)
);

CREATE INDEX IF NOT EXISTS idx_miniapp_payment_allocations_charge_id ON miniapp_payment_allocations(charge_id);
CREATE INDEX IF NOT EXISTS idx_miniapp_payment_allocations_payment_id ON miniapp_payment_allocations(payment_id);

CREATE TABLE IF NOT EXISTS miniapp_payment_rule_change_requests (
  id bigserial PRIMARY KEY,
  client_id int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rental_id int REFERENCES rentals(id) ON DELETE SET NULL,
  bike_id int REFERENCES bikes(id) ON DELETE SET NULL,
  current_rule_id bigint REFERENCES payment_rules(id) ON DELETE SET NULL,
  requested_monthly_amount numeric NOT NULL CHECK (requested_monthly_amount > 0),
  requested_parts jsonb NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  admin_note text,
  created_by_telegram_id bigint,
  decided_by_telegram_id bigint,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_miniapp_rule_requests_status ON miniapp_payment_rule_change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_miniapp_rule_requests_client ON miniapp_payment_rule_change_requests(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION miniapp_charge_category(p_charge_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_charge_type, 'other'))
    WHEN 'rent' THEN 'rent'
    WHEN 'rent_plan' THEN 'rent'
    WHEN 'rental_plan' THEN 'rent'
    WHEN 'rent_fake' THEN 'rent'
    WHEN 'planned_rent' THEN 'rent'
    WHEN 'rental' THEN 'rent'
    WHEN 'deposit' THEN 'deposit'
    WHEN 'repair' THEN 'repair'
    WHEN 'service' THEN 'repair'
    WHEN 'parts' THEN 'parts'
    WHEN 'part' THEN 'parts'
    WHEN 'battery' THEN 'battery'
    WHEN 'charger' THEN 'charger'
    WHEN 'fine' THEN 'fine'
    WHEN 'penalty' THEN 'fine'
    WHEN 'damage' THEN 'fine'
    WHEN 'discount' THEN 'discount'
    WHEN 'adjustment' THEN 'adjustment'
    WHEN 'manual' THEN 'manual'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION miniapp_category_label(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_category, 'other'))
    WHEN 'rent' THEN 'Аренда'
    WHEN 'deposit' THEN 'Депозит'
    WHEN 'repair' THEN 'Ремонт'
    WHEN 'parts' THEN 'Запчасти'
    WHEN 'battery' THEN 'Батарея'
    WHEN 'charger' THEN 'Зарядка'
    WHEN 'fine' THEN 'Штраф / компенсация'
    WHEN 'discount' THEN 'Скидка'
    WHEN 'adjustment' THEN 'Корректировка'
    WHEN 'manual' THEN 'Ручное начисление'
    WHEN 'advance' THEN 'Аванс / переплата'
    ELSE 'Другое'
  END;
$$;


CREATE OR REPLACE FUNCTION miniapp_charge_origin(p_charge_type text, p_notes text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_charge_type, '')) IN ('rent_plan','rental_plan','rent_fake','planned_rent') THEN 'planned'
    WHEN lower(coalesce(p_charge_type, '')) = 'rent' AND coalesce(p_notes, '') ILIKE '%[miniapp_plan]%' THEN 'planned'
    WHEN lower(coalesce(p_charge_type, '')) = 'rent' AND coalesce(p_notes, '') ILIKE '%miniapp_generated_by_rule%' THEN 'planned'
    ELSE 'real'
  END;
$$;

CREATE OR REPLACE FUNCTION miniapp_charge_origin_label(p_origin text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_origin, 'real'))
    WHEN 'planned' THEN 'Фиктивный план аренды'
    ELSE 'Реальный долг / ручное начисление'
  END;
$$;

CREATE OR REPLACE VIEW miniapp_client_auth_map AS
SELECT DISTINCT
  c.id AS client_id,
  c.name AS client_name,
  c.phone AS client_phone,
  c.email AS client_email,
  c.address AS client_address,
  c.doc_type AS client_doc_type,
  c.doc_number AS client_doc_number,
  COALESCE(tu.telegram_id, c.telegram_id) AS telegram_id,
  c.telegram_id AS client_telegram_id,
  tu.telegram_id AS private_telegram_id,
  tu.has_private_chat
FROM clients c
LEFT JOIN telegram_users tu ON tu.client_id = c.id
WHERE COALESCE(tu.telegram_id, c.telegram_id) IS NOT NULL;

CREATE OR REPLACE VIEW miniapp_debt_items AS
SELECT
  ch.id AS charge_id,
  ch.client_id,
  c.name AS client_name,
  c.phone AS client_phone,
  c.telegram_id AS client_telegram_id,
  tu.telegram_id AS private_telegram_id,
  ch.rental_id,
  COALESCE(ch.bike_id, r.bike_id) AS bike_id,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  ch.charge_type,
  ch.amount,
  ch.paid_amount,
  (ch.amount - ch.paid_amount)::numeric AS debt_left,
  ch.due_date,
  ch.status,
  ch.notes,
  ch.client_note,
  ch.admin_note,
  ch.promised_date,
  ch.reminder_paused_until,
  ch.created_at,
  (ex.charge_id IS NOT NULL) AS is_excluded,
  ex.reason AS exclusion_reason,
  GREATEST((CURRENT_DATE - ch.due_date), 0)::int AS overdue_days,
  miniapp_charge_category(ch.charge_type) AS category,
  miniapp_category_label(miniapp_charge_category(ch.charge_type)) AS category_label,
  miniapp_charge_origin(ch.charge_type, ch.notes) AS charge_origin,
  miniapp_charge_origin_label(miniapp_charge_origin(ch.charge_type, ch.notes)) AS charge_origin_label,
  ch.period_start,
  ch.period_end
FROM client_charges ch
JOIN clients c ON c.id = ch.client_id
LEFT JOIN rentals r ON r.id = ch.rental_id
LEFT JOIN bikes b ON b.id = COALESCE(ch.bike_id, r.bike_id)
LEFT JOIN telegram_users tu ON tu.client_id = c.id AND tu.has_private_chat = true
LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
WHERE ch.status IN ('due', 'partial')
  AND ch.amount > ch.paid_amount;

CREATE OR REPLACE VIEW miniapp_payment_allocations_view AS
SELECT
  a.id,
  a.payment_id,
  a.charge_id,
  p.client_id,
  c.name AS client_name,
  p.amount AS payment_amount,
  a.amount AS allocated_amount,
  p.payment_date,
  p.method,
  p.notes AS payment_notes,
  ch.charge_type,
  miniapp_charge_category(ch.charge_type) AS category,
  miniapp_category_label(miniapp_charge_category(ch.charge_type)) AS category_label,
  miniapp_charge_origin(ch.charge_type, ch.notes) AS charge_origin,
  miniapp_charge_origin_label(miniapp_charge_origin(ch.charge_type, ch.notes)) AS charge_origin_label,
  ch.due_date,
  ch.amount AS charge_amount,
  ch.paid_amount AS charge_paid_amount,
  a.created_by_telegram_id,
  a.created_at
FROM miniapp_payment_allocations a
JOIN client_payments p ON p.id = a.payment_id
JOIN client_charges ch ON ch.id = a.charge_id
JOIN clients c ON c.id = p.client_id;

CREATE OR REPLACE VIEW miniapp_client_balance_summary AS
WITH charge_totals AS (
  SELECT
    ch.client_id,
    COALESCE(SUM(ch.amount) FILTER (WHERE ex.charge_id IS NULL), 0)::numeric AS charged_total,
    COALESCE(SUM(ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL), 0)::numeric AS paid_on_charges,
    COALESCE(SUM(ch.amount - ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL AND ch.status IN ('due','partial') AND ch.amount > ch.paid_amount), 0)::numeric AS open_debt_total,
    COALESCE(SUM(ch.amount - ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL AND ch.status IN ('due','partial') AND ch.amount > ch.paid_amount AND ch.due_date < CURRENT_DATE), 0)::numeric AS overdue_total
  FROM client_charges ch
  LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
  GROUP BY ch.client_id
), payment_totals AS (
  SELECT
    p.client_id,
    COALESCE(SUM(p.amount), 0)::numeric AS payments_total
  FROM client_payments p
  GROUP BY p.client_id
)
SELECT
  c.id AS client_id,
  c.name AS client_name,
  c.phone AS client_phone,
  c.telegram_id,
  COALESCE(ct.charged_total, 0)::numeric AS charged_total,
  COALESCE(ct.paid_on_charges, 0)::numeric AS paid_on_charges,
  COALESCE(pt.payments_total, 0)::numeric AS payments_total,
  GREATEST(COALESCE(pt.payments_total, 0) - COALESCE(ct.paid_on_charges, 0), 0)::numeric AS unallocated_advance,
  COALESCE(ct.open_debt_total, 0)::numeric AS open_debt_total,
  COALESCE(ct.overdue_total, 0)::numeric AS overdue_total,
  (COALESCE(pt.payments_total, 0) - COALESCE(ct.charged_total, 0))::numeric AS net_balance
FROM clients c
LEFT JOIN charge_totals ct ON ct.client_id = c.id
LEFT JOIN payment_totals pt ON pt.client_id = c.id;

CREATE OR REPLACE VIEW miniapp_client_category_balances AS
WITH cats AS (
  SELECT
    ch.client_id,
    miniapp_charge_category(ch.charge_type) AS category,
    miniapp_category_label(miniapp_charge_category(ch.charge_type)) AS category_label,
    COALESCE(SUM(ch.amount) FILTER (WHERE ex.charge_id IS NULL), 0)::numeric AS charged_total,
    COALESCE(SUM(ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL), 0)::numeric AS paid_total,
    COALESCE(SUM(ch.amount - ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL AND ch.status IN ('due','partial') AND ch.amount > ch.paid_amount), 0)::numeric AS open_total,
    COALESCE(SUM(ch.amount - ch.paid_amount) FILTER (WHERE ex.charge_id IS NULL AND ch.status IN ('due','partial') AND ch.amount > ch.paid_amount AND ch.due_date < CURRENT_DATE), 0)::numeric AS overdue_total
  FROM client_charges ch
  LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
  GROUP BY ch.client_id, miniapp_charge_category(ch.charge_type), miniapp_category_label(miniapp_charge_category(ch.charge_type))
), adv AS (
  SELECT
    client_id,
    'advance'::text AS category,
    miniapp_category_label('advance') AS category_label,
    0::numeric AS charged_total,
    GREATEST(payments_total - paid_on_charges, 0)::numeric AS paid_total,
    (-GREATEST(payments_total - paid_on_charges, 0))::numeric AS open_total,
    0::numeric AS overdue_total
  FROM miniapp_client_balance_summary
  WHERE GREATEST(payments_total - paid_on_charges, 0) > 0
)
SELECT * FROM cats
UNION ALL
SELECT * FROM adv;


-- PATCH 0.391: auto-allocation of existing advance to newly created/open charges.
CREATE OR REPLACE FUNCTION miniapp_allocate_client_advance(
  p_client_id int,
  p_admin_tg_id bigint DEFAULT NULL,
  p_charge_category text DEFAULT 'auto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_charge record;
  v_payment record;
  v_alloc numeric;
  v_total_allocated numeric := 0;
  v_allocations int := 0;
  v_charge_ids bigint[] := ARRAY[]::bigint[];
  v_payment_ids bigint[] := ARRAY[]::bigint[];
  v_category text := lower(coalesce(nullif(trim(p_charge_category), ''), 'auto'));
BEGIN
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required';
  END IF;

  FOR v_charge IN
    SELECT ch.*
    FROM client_charges ch
    WHERE ch.client_id = p_client_id
      AND NOT EXISTS (SELECT 1 FROM miniapp_debt_exclusions ex WHERE ex.charge_id = ch.id)
      AND coalesce(ch.amount, 0) > coalesce(ch.paid_amount, 0)
      AND coalesce(ch.status, 'due') IN ('due','partial','unpaid','overdue','open','pending')
      AND (v_category IN ('auto','all','') OR miniapp_charge_category(ch.charge_type) = v_category)
    ORDER BY coalesce(ch.due_date, ch.created_at::date), ch.id
    FOR UPDATE
  LOOP
    FOR v_payment IN
      SELECT
        p.id,
        p.amount,
        coalesce(p.payment_date, p.created_at::date) AS payment_date,
        (coalesce(p.amount, 0) - coalesce((SELECT sum(a.amount) FROM miniapp_payment_allocations a WHERE a.payment_id = p.id), 0))::numeric AS available
      FROM client_payments p
      WHERE p.client_id = p_client_id
        AND coalesce(p.amount, 0) > 0
        AND (coalesce(p.amount, 0) - coalesce((SELECT sum(a.amount) FROM miniapp_payment_allocations a WHERE a.payment_id = p.id), 0)) > 0
      ORDER BY coalesce(p.payment_date, p.created_at::date), p.id
      FOR UPDATE OF p
    LOOP
      EXIT WHEN coalesce(v_charge.amount, 0) <= coalesce(v_charge.paid_amount, 0);
      v_alloc := least(v_payment.available, coalesce(v_charge.amount, 0) - coalesce(v_charge.paid_amount, 0));
      IF v_alloc <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO miniapp_payment_allocations (payment_id, charge_id, amount, created_by_telegram_id)
      VALUES (v_payment.id, v_charge.id, v_alloc, p_admin_tg_id)
      ON CONFLICT (payment_id, charge_id) DO UPDATE
        SET amount = miniapp_payment_allocations.amount + excluded.amount;

      UPDATE client_charges
      SET paid_amount = coalesce(paid_amount, 0) + v_alloc,
          status = CASE WHEN coalesce(paid_amount, 0) + v_alloc >= amount THEN 'paid' ELSE 'partial' END,
          paid_at = CASE WHEN coalesce(paid_amount, 0) + v_alloc >= amount THEN now() ELSE paid_at END,
          updated_at = now(),
          notes = trim(both E'\n' from concat_ws(E'\n', notes, '[auto_advance_allocation] payment #' || v_payment.id::text || ' allocated ' || v_alloc::text))
      WHERE id = v_charge.id;

      v_charge.paid_amount := coalesce(v_charge.paid_amount, 0) + v_alloc;
      v_total_allocated := v_total_allocated + v_alloc;
      v_allocations := v_allocations + 1;
      v_charge_ids := array_append(v_charge_ids, v_charge.id);
      v_payment_ids := array_append(v_payment_ids, v_payment.id);
    END LOOP;
  END LOOP;

  PERFORM miniapp_audit(
    p_admin_tg_id,
    'miniapp_allocate_client_advance',
    jsonb_build_object(
      'client_id', p_client_id,
      'charge_category', v_category,
      'allocated_amount', v_total_allocated,
      'allocations_count', v_allocations,
      'charge_ids', v_charge_ids,
      'payment_ids', v_payment_ids
    )
  );

  RETURN jsonb_build_object(
    'client_id', p_client_id,
    'allocated_amount', v_total_allocated,
    'allocations_count', v_allocations,
    'charge_ids', v_charge_ids,
    'payment_ids', v_payment_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_create_manual_charge(
  p_client_id int,
  p_rental_id int DEFAULT NULL,
  p_bike_id int DEFAULT NULL,
  p_charge_type text DEFAULT 'manual',
  p_amount numeric DEFAULT 0,
  p_due_date date DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_amount = 0 THEN
    RAISE EXCEPTION 'amount cannot be 0';
  END IF;

  INSERT INTO client_charges (
    client_id, rental_id, bike_id, charge_type, amount, due_date,
    status, paid_amount, notes, period_start, period_end, created_at, updated_at
  ) VALUES (
    p_client_id, p_rental_id, p_bike_id, COALESCE(NULLIF(trim(p_charge_type), ''), 'manual'), p_amount, COALESCE(p_due_date, CURRENT_DATE),
    CASE WHEN p_amount < 0 THEN 'paid' ELSE 'due' END,
    CASE WHEN p_amount < 0 THEN p_amount ELSE 0 END,
    p_note, p_period_start, p_period_end, now(), now()
  )
  RETURNING id INTO v_id;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_create_manual_charge', jsonb_build_object('charge_id', v_id, 'client_id', p_client_id, 'charge_type', p_charge_type, 'amount', p_amount));

  -- If the client already has an advance/unallocated payment, immediately apply it to this new charge.
  IF p_amount > 0 THEN
    RETURN jsonb_build_object(
      'charge_id', v_id,
      'allocation', miniapp_allocate_client_advance(p_client_id, p_admin_tg_id, 'auto')
    );
  END IF;

  RETURN jsonb_build_object('charge_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_record_manual_payment(
  p_client_id int,
  p_amount numeric,
  p_method text DEFAULT 'manual',
  p_payment_date date DEFAULT NULL,
  p_payment_category text DEFAULT 'auto',
  p_allocation_mode text DEFAULT 'oldest',
  p_charge_ids bigint[] DEFAULT ARRAY[]::bigint[],
  p_note text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id bigint;
  v_remaining numeric;
  v_alloc numeric;
  v_allocated numeric := 0;
  v_charge record;
  v_allocated_ids bigint[] := ARRAY[]::bigint[];
  v_mode text := lower(coalesce(p_allocation_mode, 'oldest'));
  v_category text := lower(coalesce(p_payment_category, 'auto'));
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;
  IF v_mode NOT IN ('oldest','selected','advance') THEN
    RAISE EXCEPTION 'allocation_mode must be oldest, selected, or advance';
  END IF;

  INSERT INTO client_payments (client_id, rental_id, charge_id, amount, payment_date, method, notes, created_by_telegram_id, created_at)
  VALUES (p_client_id, NULL, NULL, p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_method, p_note, p_admin_tg_id, now())
  RETURNING id INTO v_payment_id;

  v_remaining := p_amount;

  IF v_mode <> 'advance' THEN
    FOR v_charge IN
      SELECT ch.*
      FROM client_charges ch
      LEFT JOIN miniapp_debt_exclusions ex ON ex.charge_id = ch.id
      WHERE ch.client_id = p_client_id
        AND ex.charge_id IS NULL
        AND ch.status IN ('due','partial')
        AND ch.amount > ch.paid_amount
        AND (v_mode <> 'selected' OR ch.id = ANY(p_charge_ids))
        AND (v_category IN ('auto','all','') OR miniapp_charge_category(ch.charge_type) = v_category)
      ORDER BY ch.due_date ASC, ch.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, v_charge.amount - v_charge.paid_amount);

      INSERT INTO miniapp_payment_allocations (payment_id, charge_id, amount, created_by_telegram_id)
      VALUES (v_payment_id, v_charge.id, v_alloc, p_admin_tg_id)
      ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount = miniapp_payment_allocations.amount + EXCLUDED.amount;

      UPDATE client_charges
      SET paid_amount = paid_amount + v_alloc,
          status = CASE WHEN paid_amount + v_alloc >= amount THEN 'paid' ELSE 'partial' END,
          paid_at = CASE WHEN paid_amount + v_alloc >= amount THEN now() ELSE paid_at END,
          updated_at = now(),
          notes = trim(both E'\n' from concat_ws(E'\n', notes, 'manual_payment #' || v_payment_id::text || ' allocated ' || v_alloc::text))
      WHERE id = v_charge.id;

      v_remaining := v_remaining - v_alloc;
      v_allocated := v_allocated + v_alloc;
      v_allocated_ids := array_append(v_allocated_ids, v_charge.id);
    END LOOP;
  END IF;

  -- A payment can create an advance. Try to allocate any remaining advance to open client charges.
  PERFORM miniapp_allocate_client_advance(p_client_id, p_admin_tg_id, v_category);

  PERFORM miniapp_audit(
    p_admin_tg_id,
    'miniapp_record_manual_payment',
    jsonb_build_object('payment_id', v_payment_id, 'client_id', p_client_id, 'amount', p_amount, 'allocated', v_allocated, 'advance', v_remaining, 'mode', v_mode, 'category', v_category)
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'client_id', p_client_id,
    'amount', p_amount,
    'allocated_amount', v_allocated,
    'advance_amount', v_remaining,
    'allocated_charge_ids', v_allocated_ids
  );
END;
$$;


CREATE OR REPLACE FUNCTION miniapp_close_plan_charges(
  p_charge_ids bigint[],
  p_create_payment boolean DEFAULT false,
  p_payment_date date DEFAULT NULL,
  p_method text DEFAULT 'manual_plan_close',
  p_note text DEFAULT 'manual close planned rent',
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ch record;
  v_closed_ids bigint[] := ARRAY[]::bigint[];
  v_paid_ids bigint[] := ARRAY[]::bigint[];
  v_skipped_ids bigint[] := ARRAY[]::bigint[];
  v_payment_ids bigint[] := ARRAY[]::bigint[];
  v_payment_id bigint;
  v_amount numeric;
BEGIN
  FOR ch IN
    SELECT * FROM client_charges
    WHERE id = ANY(p_charge_ids)
      AND status IN ('due','partial')
      AND amount > COALESCE(paid_amount, 0)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF miniapp_charge_origin(ch.charge_type, ch.notes) <> 'planned' THEN
      v_skipped_ids := array_append(v_skipped_ids, ch.id);
      CONTINUE;
    END IF;

    v_amount := ch.amount - COALESCE(ch.paid_amount, 0);

    IF COALESCE(p_create_payment, false) THEN
      -- РУЧНОЕ действие админа: закрываем фиктивный план и создаём реальную оплату.
      -- Это НЕ используется при смене правила оплаты: там старые неоплаченные планы удаляются, оплаты не создаются.
      INSERT INTO client_payments (
        client_id, rental_id, charge_id, amount, payment_date, method, notes,
        created_by_telegram_id, created_at
      )
      VALUES (
        ch.client_id, ch.rental_id, ch.id, v_amount, COALESCE(p_payment_date, CURRENT_DATE),
        COALESCE(NULLIF(trim(p_method), ''), 'manual_plan_close'),
        COALESCE(p_note, 'manual planned rent close with payment'),
        p_admin_tg_id, now()
      )
      RETURNING id INTO v_payment_id;

      INSERT INTO miniapp_payment_allocations (payment_id, charge_id, amount, created_by_telegram_id)
      VALUES (v_payment_id, ch.id, v_amount, p_admin_tg_id)
      ON CONFLICT (payment_id, charge_id) DO UPDATE
        SET amount = miniapp_payment_allocations.amount + EXCLUDED.amount;

      UPDATE client_charges
      SET paid_amount = amount,
          status = 'paid',
          paid_at = now(),
          updated_at = now(),
          notes = trim(both E'\n' from concat_ws(E'\n', notes, '[manual_plan_payment] payment_id=' || v_payment_id::text || '; payment_date=' || COALESCE(p_payment_date, CURRENT_DATE)::text || '; ' || COALESCE(p_note, '')))
      WHERE id = ch.id;

      v_paid_ids := array_append(v_paid_ids, ch.id);
      v_payment_ids := array_append(v_payment_ids, v_payment_id);
    ELSE
      -- РУЧНОЕ действие админа: просто закрыть план-чеклист без факта оплаты.
      UPDATE client_charges
      SET paid_amount = amount,
          status = 'paid',
          paid_at = now(),
          updated_at = now(),
          notes = trim(both E'\n' from concat_ws(E'\n', notes, '[plan_closed_without_payment] ' || COALESCE(p_note, '') || '; closed_at=' || COALESCE(p_payment_date, CURRENT_DATE)::text))
      WHERE id = ch.id;

      v_closed_ids := array_append(v_closed_ids, ch.id);
    END IF;
  END LOOP;

  PERFORM miniapp_audit(
    p_admin_tg_id,
    'miniapp_close_plan_charges',
    jsonb_build_object(
      'charge_ids', p_charge_ids,
      'create_payment', COALESCE(p_create_payment, false),
      'payment_date', COALESCE(p_payment_date, CURRENT_DATE),
      'closed_ids', v_closed_ids,
      'paid_ids', v_paid_ids,
      'payment_ids', v_payment_ids,
      'skipped_ids', v_skipped_ids
    )
  );

  RETURN jsonb_build_object(
    'closed_ids', v_closed_ids,
    'paid_ids', v_paid_ids,
    'payment_ids', v_payment_ids,
    'skipped_ids', v_skipped_ids,
    'create_payment', COALESCE(p_create_payment, false)
  );
END;
$$;

-- Backward-compatible wrapper for older deployed API code.
CREATE OR REPLACE FUNCTION miniapp_close_plan_charges_without_payment(
  p_charge_ids bigint[],
  p_note text DEFAULT 'closed planned rent without real payment',
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN miniapp_close_plan_charges(
    p_charge_ids := p_charge_ids,
    p_create_payment := false,
    p_payment_date := CURRENT_DATE,
    p_method := 'plan_only',
    p_note := p_note,
    p_admin_tg_id := p_admin_tg_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_record_bike_payment(
  p_bike_id int,
  p_amount numeric,
  p_method text DEFAULT 'manual_chat',
  p_payment_date date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental rentals%ROWTYPE;
  v_payment_id bigint;
  v_remaining numeric;
  v_alloc numeric;
  v_allocated numeric := 0;
  v_charge record;
  v_allocated_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  SELECT * INTO v_rental
  FROM rentals
  WHERE bike_id = p_bike_id AND status = 'active'
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'У велика #% нет active-аренды.', p_bike_id;
  END IF;

  INSERT INTO client_payments (client_id, rental_id, charge_id, amount, payment_date, method, notes, created_by_telegram_id, created_at)
  VALUES (v_rental.client_id, v_rental.id, NULL, p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_method, COALESCE(p_note, 'quick bike payment'), p_admin_tg_id, now())
  RETURNING id INTO v_payment_id;

  v_remaining := p_amount;

  FOR v_charge IN
    SELECT ch.*
    FROM client_charges ch
    WHERE ch.client_id = v_rental.client_id
      AND ch.rental_id = v_rental.id
      AND NOT EXISTS (SELECT 1 FROM miniapp_debt_exclusions ex WHERE ex.charge_id = ch.id)
      AND ch.status IN ('due','partial')
      AND ch.amount > ch.paid_amount
      AND miniapp_charge_category(ch.charge_type) = 'rent'
    ORDER BY ch.due_date ASC, ch.id ASC
    FOR UPDATE OF ch
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_alloc := LEAST(v_remaining, v_charge.amount - v_charge.paid_amount);

    INSERT INTO miniapp_payment_allocations (payment_id, charge_id, amount, created_by_telegram_id)
    VALUES (v_payment_id, v_charge.id, v_alloc, p_admin_tg_id)
    ON CONFLICT (payment_id, charge_id) DO UPDATE SET amount = miniapp_payment_allocations.amount + EXCLUDED.amount;

    UPDATE client_charges
    SET paid_amount = paid_amount + v_alloc,
        status = CASE WHEN paid_amount + v_alloc >= amount THEN 'paid' ELSE 'partial' END,
        paid_at = CASE WHEN paid_amount + v_alloc >= amount THEN now() ELSE paid_at END,
        updated_at = now(),
        notes = trim(both E'
' from concat_ws(E'
', notes, '[real_payment] payment #' || v_payment_id::text || ' allocated ' || v_alloc::text))
    WHERE id = v_charge.id;

    v_remaining := v_remaining - v_alloc;
    v_allocated := v_allocated + v_alloc;
    v_allocated_ids := array_append(v_allocated_ids, v_charge.id);
  END LOOP;

  -- If this payment has an unallocated remainder, allocate it against any other open client charges.
  PERFORM miniapp_allocate_client_advance(v_rental.client_id, p_admin_tg_id, 'auto');

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_record_bike_payment', jsonb_build_object('bike_id', p_bike_id, 'payment_id', v_payment_id, 'amount', p_amount, 'allocated', v_allocated, 'advance', v_remaining));
  RETURN jsonb_build_object('bike_id', p_bike_id, 'client_id', v_rental.client_id, 'rental_id', v_rental.id, 'payment_id', v_payment_id, 'amount', p_amount, 'allocated_amount', v_allocated, 'advance_amount', v_remaining, 'allocated_charge_ids', v_allocated_ids);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_client_request_payment_rule_change(
  p_client_tg_id bigint,
  p_rental_id int,
  p_monthly_amount numeric,
  p_parts jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_id int;
  v_rental rentals%ROWTYPE;
  v_current_rule payment_rules%ROWTYPE;
  v_part jsonb;
  v_sum numeric := 0;
  v_due_day int;
  v_amount numeric;
  v_request_id bigint;
BEGIN
  SELECT client_id INTO v_client_id
  FROM miniapp_client_auth_map
  WHERE telegram_id = p_client_tg_id
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Telegram не привязан к клиенту.';
  END IF;

  SELECT * INTO v_rental
  FROM rentals
  WHERE id = p_rental_id AND client_id = v_client_id AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active аренда не найдена или не принадлежит клиенту.';
  END IF;

  IF p_monthly_amount <= 0 THEN
    RAISE EXCEPTION 'monthly_amount должен быть больше 0.';
  END IF;

  IF jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) = 0 THEN
    RAISE EXCEPTION 'parts должен быть непустым массивом.';
  END IF;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    v_due_day := (v_part->>'due_day')::int;
    v_amount := (v_part->>'amount')::numeric;
    IF v_due_day < 1 OR v_due_day > 31 THEN
      RAISE EXCEPTION 'День оплаты должен быть 1-31.';
    END IF;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Сумма части должна быть больше 0.';
    END IF;
    v_sum := v_sum + v_amount;
  END LOOP;

  IF v_sum < p_monthly_amount THEN
    RAISE EXCEPTION 'Сумма частей меньше месячной суммы: нужно %, указано %.', p_monthly_amount, v_sum;
  END IF;

  SELECT * INTO v_current_rule
  FROM payment_rules
  WHERE rental_id = p_rental_id AND is_active = true
  ORDER BY id DESC
  LIMIT 1;

  INSERT INTO miniapp_payment_rule_change_requests (
    client_id, rental_id, bike_id, current_rule_id, requested_monthly_amount,
    requested_parts, reason, status, created_by_telegram_id, created_at, updated_at
  ) VALUES (
    v_client_id, v_rental.id, v_rental.bike_id, v_current_rule.id, p_monthly_amount,
    p_parts, p_reason, 'pending', p_client_tg_id, now(), now()
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('request_id', v_request_id, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_admin_decide_payment_rule_change(
  p_request_id bigint,
  p_decision text,
  p_admin_note text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req miniapp_payment_rule_change_requests%ROWTYPE;
  v_part jsonb;
  v_part_number int := 0;
  v_rule payment_rules%ROWTYPE;
  v_decision text := lower(coalesce(p_decision, 'reject'));
BEGIN
  SELECT * INTO v_req
  FROM miniapp_payment_rule_change_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Запрос #% не найден.', p_request_id;
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Запрос #% уже обработан: %.', p_request_id, v_req.status;
  END IF;
  IF v_decision NOT IN ('approve','approved','reject','rejected') THEN
    RAISE EXCEPTION 'decision must be approve or reject';
  END IF;

  IF v_decision IN ('approve','approved') THEN
    UPDATE payment_rules
    SET is_active = false,
        updated_at = now(),
        notes = trim(both E'\n' from concat_ws(E'\n', notes, 'disabled_by_approved_client_request #' || p_request_id::text))
    WHERE rental_id = v_req.rental_id AND is_active = true;

    INSERT INTO payment_rules (
      client_id, rental_id, is_active, weekly_amount, split_mode,
      remind_client, remind_admin, admin_only, grace_days, notes,
      monthly_amount, period_type, min_period_amount,
      allow_client_edit, requires_admin_approval, created_at
    ) VALUES (
      v_req.client_id, v_req.rental_id, true, v_req.requested_monthly_amount, 'monthly_parts',
      true, true, false, 0,
      trim(both E'\n' from concat_ws(E'\n', 'approved_client_request #' || p_request_id::text, p_admin_note, v_req.reason)),
      v_req.requested_monthly_amount, 'monthly', v_req.requested_monthly_amount,
      true, true, now()
    )
    RETURNING * INTO v_rule;

    FOR v_part IN SELECT * FROM jsonb_array_elements(v_req.requested_parts)
    LOOP
      v_part_number := v_part_number + 1;
      INSERT INTO payment_rule_parts (rule_id, part_number, due_day, amount)
      VALUES (v_rule.id, v_part_number, (v_part->>'due_day')::int, (v_part->>'amount')::numeric);
    END LOOP;

    UPDATE miniapp_payment_rule_change_requests
    SET status = 'approved', admin_note = p_admin_note, decided_by_telegram_id = p_admin_tg_id, decided_at = now(), updated_at = now()
    WHERE id = p_request_id;

    PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_admin_approve_payment_rule_change', jsonb_build_object('request_id', p_request_id, 'rule_id', v_rule.id));
    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'approved', 'rule_id', v_rule.id);
  ELSE
    UPDATE miniapp_payment_rule_change_requests
    SET status = 'rejected', admin_note = p_admin_note, decided_by_telegram_id = p_admin_tg_id, decided_at = now(), updated_at = now()
    WHERE id = p_request_id;

    PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_admin_reject_payment_rule_change', jsonb_build_object('request_id', p_request_id));
    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'rejected');
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- v0.3.3 Bike Health / odometer / service base
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batteries ADD COLUMN IF NOT EXISTS first_used_at timestamptz;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS health_notes text;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS bike_odometer_reports (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  bike_id bigint NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  rental_id bigint REFERENCES rentals(id) ON DELETE SET NULL,
  client_id bigint REFERENCES clients(id) ON DELETE SET NULL,
  odometer_km numeric(12,1) NOT NULL CHECK (odometer_km >= 0),
  source text NOT NULL DEFAULT 'manual', -- client / admin / bot / roapp / manual
  reported_by_telegram_id bigint,
  reported_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bike_odometer_reports_bike_time
  ON bike_odometer_reports(bike_id, reported_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_bike_odometer_reports_client
  ON bike_odometer_reports(client_id, reported_at DESC) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bike_service_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  bike_id bigint NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  rental_id bigint REFERENCES rentals(id) ON DELETE SET NULL,
  client_id bigint REFERENCES clients(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'service', -- service / repair / battery_replace / brakes / tire / chain / other
  title text NOT NULL,
  description text,
  odometer_km numeric(12,1),
  cost numeric(12,2) DEFAULT 0,
  performed_at date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'manual', -- miniapp / bot / roapp / manual
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bike_service_events_bike_date
  ON bike_service_events(bike_id, performed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS bike_maintenance_tasks (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  bike_id bigint NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  rental_id bigint REFERENCES rentals(id) ON DELETE SET NULL,
  client_id bigint REFERENCES clients(id) ON DELETE SET NULL,
  task_type text NOT NULL DEFAULT 'regular_service',
  status text NOT NULL DEFAULT 'open', -- open / done / ignored
  priority text NOT NULL DEFAULT 'normal', -- low / normal / high
  trigger_km numeric(12,1),
  current_km numeric(12,1),
  due_km numeric(12,1),
  title text NOT NULL,
  description text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  closed_by_telegram_id bigint
);

CREATE INDEX IF NOT EXISTS idx_bike_maintenance_tasks_open
  ON bike_maintenance_tasks(status, priority, bike_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS miniapp_notifications (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  target_role text NOT NULL DEFAULT 'admin', -- admin / client
  client_id bigint REFERENCES clients(id) ON DELETE CASCADE,
  bike_id bigint REFERENCES bikes(id) ON DELETE CASCADE,
  notification_type text NOT NULL, -- payment_due / km_request / maintenance_due / repair_alert
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info', -- info / warning / critical
  status text NOT NULL DEFAULT 'unread', -- unread / read / done / ignored
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  done_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_miniapp_notifications_open
  ON miniapp_notifications(target_role, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_miniapp_notifications_bike
  ON miniapp_notifications(bike_id, status) WHERE bike_id IS NOT NULL;

CREATE OR REPLACE FUNCTION miniapp_last_bike_odometer(p_bike_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT odometer_km
  FROM bike_odometer_reports
  WHERE bike_id = p_bike_id
  ORDER BY reported_at DESC, id DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION miniapp_record_odometer(
  p_bike_id bigint,
  p_odometer_km numeric,
  p_source text DEFAULT 'miniapp',
  p_reported_by_telegram_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_lower boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active rentals%ROWTYPE;
  v_last numeric;
  v_last_service numeric;
  v_report_id bigint;
  v_since_service numeric;
  v_task_id bigint;
BEGIN
  IF p_bike_id IS NULL OR p_bike_id <= 0 THEN
    RAISE EXCEPTION 'bike_id is required';
  END IF;
  IF p_odometer_km IS NULL OR p_odometer_km < 0 THEN
    RAISE EXCEPTION 'Пробег должен быть 0 или больше.';
  END IF;

  SELECT * INTO v_active
  FROM rentals
  WHERE bike_id = p_bike_id AND status = 'active'
  ORDER BY id DESC
  LIMIT 1;

  SELECT odometer_km INTO v_last
  FROM bike_odometer_reports
  WHERE bike_id = p_bike_id
  ORDER BY reported_at DESC, id DESC
  LIMIT 1;

  IF v_last IS NOT NULL AND p_odometer_km < v_last AND NOT p_allow_lower THEN
    RAISE EXCEPTION 'Новый пробег (%) меньше прошлого (%). Если это замена дисплея/ошибка, админ должен ввести override.', p_odometer_km, v_last;
  END IF;

  INSERT INTO bike_odometer_reports (
    bike_id, rental_id, client_id, odometer_km, source,
    reported_by_telegram_id, reported_at, notes
  ) VALUES (
    p_bike_id,
    CASE WHEN v_active.id IS NULL THEN NULL ELSE v_active.id END,
    CASE WHEN v_active.client_id IS NULL THEN NULL ELSE v_active.client_id END,
    p_odometer_km,
    COALESCE(NULLIF(p_source, ''), 'miniapp'),
    p_reported_by_telegram_id,
    now(),
    p_notes
  ) RETURNING id INTO v_report_id;

  SELECT odometer_km INTO v_last_service
  FROM bike_service_events
  WHERE bike_id = p_bike_id
    AND event_type IN ('service','regular_service','simple_to','maintenance')
    AND odometer_km IS NOT NULL
  ORDER BY performed_at DESC, id DESC
  LIMIT 1;

  v_since_service := p_odometer_km - COALESCE(v_last_service, 0);

  IF v_since_service >= 1000 THEN
    SELECT id INTO v_task_id
    FROM bike_maintenance_tasks
    WHERE bike_id = p_bike_id AND task_type = 'regular_service' AND status = 'open'
    ORDER BY id DESC
    LIMIT 1;

    IF v_task_id IS NULL THEN
      INSERT INTO bike_maintenance_tasks (
        bike_id, rental_id, client_id, task_type, status, priority,
        trigger_km, current_km, due_km, title, description, due_at
      ) VALUES (
        p_bike_id,
        CASE WHEN v_active.id IS NULL THEN NULL ELSE v_active.id END,
        CASE WHEN v_active.client_id IS NULL THEN NULL ELSE v_active.client_id END,
        'regular_service', 'open', 'high',
        1000, p_odometer_km, COALESCE(v_last_service, 0) + 1000,
        'Нужно простое ТО',
        'После последнего ТО проехал ' || round(v_since_service)::text || ' км.',
        now()
      ) RETURNING id INTO v_task_id;

      INSERT INTO miniapp_notifications (target_role, client_id, bike_id, notification_type, title, body, severity, status, due_at)
      VALUES ('admin', CASE WHEN v_active.client_id IS NULL THEN NULL ELSE v_active.client_id END, p_bike_id, 'maintenance_due',
              'Велик #' || p_bike_id::text || ': нужно ТО',
              'Пробег после сервиса: ' || round(v_since_service)::text || ' км.',
              'warning', 'unread', now());
    ELSE
      UPDATE bike_maintenance_tasks
      SET current_km = p_odometer_km,
          priority = CASE WHEN v_since_service >= 1200 THEN 'high' ELSE priority END,
          description = 'После последнего ТО проехал ' || round(v_since_service)::text || ' км.'
      WHERE id = v_task_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'report_id', v_report_id,
    'bike_id', p_bike_id,
    'odometer_km', p_odometer_km,
    'previous_km', v_last,
    'km_since_service', v_since_service,
    'task_id', v_task_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_mark_bike_service_done(
  p_bike_id bigint,
  p_odometer_km numeric DEFAULT NULL,
  p_title text DEFAULT 'Простое ТО',
  p_event_type text DEFAULT 'service',
  p_cost numeric DEFAULT 0,
  p_description text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active rentals%ROWTYPE;
  v_km numeric;
  v_event_id bigint;
  v_closed int;
BEGIN
  IF p_bike_id IS NULL OR p_bike_id <= 0 THEN
    RAISE EXCEPTION 'bike_id is required';
  END IF;

  SELECT * INTO v_active
  FROM rentals
  WHERE bike_id = p_bike_id AND status = 'active'
  ORDER BY id DESC
  LIMIT 1;

  v_km := COALESCE(p_odometer_km, miniapp_last_bike_odometer(p_bike_id), 0);

  INSERT INTO bike_service_events (
    bike_id, rental_id, client_id, event_type, title, description,
    odometer_km, cost, performed_at, source, created_by_telegram_id
  ) VALUES (
    p_bike_id,
    CASE WHEN v_active.id IS NULL THEN NULL ELSE v_active.id END,
    CASE WHEN v_active.client_id IS NULL THEN NULL ELSE v_active.client_id END,
    COALESCE(NULLIF(p_event_type, ''), 'service'),
    COALESCE(NULLIF(p_title, ''), 'Простое ТО'),
    p_description,
    v_km,
    COALESCE(p_cost, 0),
    CURRENT_DATE,
    'miniapp',
    p_admin_tg_id
  ) RETURNING id INTO v_event_id;

  UPDATE bike_maintenance_tasks
  SET status = 'done', done_at = now(), closed_by_telegram_id = p_admin_tg_id
  WHERE bike_id = p_bike_id AND status = 'open' AND task_type = 'regular_service';
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  INSERT INTO miniapp_notifications (target_role, client_id, bike_id, notification_type, title, body, severity, status)
  VALUES ('admin', CASE WHEN v_active.client_id IS NULL THEN NULL ELSE v_active.client_id END, p_bike_id, 'maintenance_done',
          'Велик #' || p_bike_id::text || ': ТО отмечено',
          'Км: ' || COALESCE(v_km::text, '-'), 'info', 'done');

  RETURN jsonb_build_object('event_id', v_event_id, 'bike_id', p_bike_id, 'odometer_km', v_km, 'closed_tasks', v_closed);
END;
$$;

CREATE OR REPLACE VIEW miniapp_bike_battery_health AS
SELECT DISTINCT ON (b.id, COALESCE(r.bike_id, b.bike_id))
  COALESCE(r.bike_id, b.bike_id) AS bike_id,
  b.id AS battery_id,
  b.type_id,
  bt.brand,
  bt.compatible_bike_model,
  bt.capacity,
  bt.generation,
  b.status,
  COALESCE(b.first_used_at, b.created_at) AS first_used_at,
  GREATEST((CURRENT_DATE - COALESCE(b.first_used_at, b.created_at)::date), 0)::int AS age_days,
  b.health_status,
  b.health_notes,
  b.last_checked_at,
  br.rental_id,
  br.created_at AS attached_at
FROM batteries b
LEFT JOIN battery_types bt ON bt.id = b.type_id
LEFT JOIN battery_rentals br ON br.battery_id = b.id AND br.status = 'active'
LEFT JOIN rentals r ON r.id = br.rental_id AND r.status = 'active'
WHERE COALESCE(r.bike_id, b.bike_id) IS NOT NULL
ORDER BY b.id, COALESCE(r.bike_id, b.bike_id), br.created_at DESC NULLS LAST;

CREATE OR REPLACE VIEW miniapp_bike_health_summary AS
WITH last_odometer AS (
  SELECT DISTINCT ON (bike_id)
    bike_id,
    id AS odometer_report_id,
    odometer_km,
    reported_at,
    source AS odometer_source,
    notes AS odometer_notes
  FROM bike_odometer_reports
  ORDER BY bike_id, reported_at DESC, id DESC
),
last_service AS (
  SELECT DISTINCT ON (bike_id)
    bike_id,
    id AS service_event_id,
    title AS last_service_title,
    event_type AS last_service_type,
    odometer_km AS last_service_km,
    performed_at AS last_service_date,
    description AS last_service_description
  FROM bike_service_events
  WHERE event_type IN ('service','regular_service','simple_to','maintenance')
  ORDER BY bike_id, performed_at DESC, id DESC
),
active_rental AS (
  SELECT DISTINCT ON (r.bike_id)
    r.bike_id,
    r.id AS active_rental_id,
    r.client_id,
    c.name AS client_name,
    c.telegram_id AS client_telegram_id
  FROM rentals r
  JOIN clients c ON c.id = r.client_id
  WHERE r.status = 'active'
  ORDER BY r.bike_id, r.id DESC
),
open_tasks AS (
  SELECT bike_id, COUNT(*)::int AS open_task_count, MAX(priority) AS max_priority
  FROM bike_maintenance_tasks
  WHERE status = 'open'
  GROUP BY bike_id
)
SELECT
  b.id AS bike_id,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  b.brand,
  b.model,
  b.status AS bike_status,
  ar.active_rental_id,
  ar.client_id,
  ar.client_name,
  ar.client_telegram_id,
  lo.odometer_report_id,
  COALESCE(lo.odometer_km, 0)::numeric AS current_km,
  lo.reported_at AS last_odometer_at,
  lo.odometer_source,
  ls.service_event_id,
  COALESCE(ls.last_service_km, 0)::numeric AS last_service_km,
  ls.last_service_date,
  ls.last_service_title,
  GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0)::numeric AS km_since_service,
  GREATEST(1000 - GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0), 0)::numeric AS km_to_service,
  CASE
    WHEN COALESCE(ot.open_task_count, 0) > 0 THEN 'needs_service'
    WHEN GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0) >= 1000 THEN 'needs_service'
    WHEN GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0) >= 800 THEN 'soon_service'
    WHEN lo.reported_at IS NULL THEN 'no_km'
    WHEN lo.reported_at < now() - interval '14 days' THEN 'km_old'
    ELSE 'ok'
  END AS health_status,
  CASE
    WHEN COALESCE(ot.open_task_count, 0) > 0 THEN 'Нужно ТО'
    WHEN GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0) >= 1000 THEN 'Нужно ТО'
    WHEN GREATEST(COALESCE(lo.odometer_km, 0) - COALESCE(ls.last_service_km, 0), 0) >= 800 THEN 'Скоро ТО'
    WHEN lo.reported_at IS NULL THEN 'Нет пробега'
    WHEN lo.reported_at < now() - interval '14 days' THEN 'Пробег устарел'
    ELSE 'OK'
  END AS health_status_label,
  COALESCE(ot.open_task_count, 0) AS open_task_count
FROM bikes b
LEFT JOIN active_rental ar ON ar.bike_id = b.id
LEFT JOIN last_odometer lo ON lo.bike_id = b.id
LEFT JOIN last_service ls ON ls.bike_id = b.id
LEFT JOIN open_tasks ot ON ot.bike_id = b.id;

CREATE OR REPLACE VIEW miniapp_client_health_bikes AS
SELECT h.*
FROM miniapp_bike_health_summary h
WHERE h.client_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- v0.3.8 Asset purchases / sales + safer quick-debt support
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bikes ADD COLUMN IF NOT EXISTS purchase_price numeric;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS sale_price numeric;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS sale_date date;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS asset_status text NOT NULL DEFAULT 'active';

ALTER TABLE batteries ADD COLUMN IF NOT EXISTS purchase_price numeric;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS sale_price numeric;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS sale_date date;
ALTER TABLE batteries ADD COLUMN IF NOT EXISTS asset_status text NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS asset_transactions (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  asset_type text NOT NULL CHECK (asset_type IN ('bike','battery','other')),
  asset_id bigint,
  transaction_type text NOT NULL CHECK (transaction_type IN ('purchase','sale','adjustment')),
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'CZK',
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  expense_id bigint REFERENCES business_expenses(id) ON DELETE SET NULL,
  notes text,
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_transactions_asset ON asset_transactions(asset_type, asset_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_asset_transactions_date ON asset_transactions(transaction_date DESC, id DESC);

CREATE OR REPLACE FUNCTION miniapp_record_asset_expense(
  p_asset_type text,
  p_asset_id bigint,
  p_transaction_type text,
  p_amount numeric,
  p_transaction_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL,
  p_currency text DEFAULT 'CZK'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expense_id bigint;
  v_tx_id bigint;
  v_expense_type text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;
  IF COALESCE(p_currency, 'CZK') <> 'CZK' THEN
    RAISE EXCEPTION 'Пока asset expense поддерживает только CZK без конвертации.';
  END IF;

  v_expense_type := CASE
    WHEN p_asset_type = 'bike' AND p_transaction_type = 'purchase' THEN 'bike_purchase'
    WHEN p_asset_type = 'battery' AND p_transaction_type = 'purchase' THEN 'battery_purchase'
    WHEN p_transaction_type = 'purchase' THEN 'procurement'
    ELSE NULL
  END;

  IF p_transaction_type = 'purchase' THEN
    INSERT INTO business_expenses (
      expense_type, bike_id, amount, expense_date, notes, created_by_telegram_id,
      supplier, payment_method, quantity, unit_price, currency, is_capex, status
    ) VALUES (
      v_expense_type,
      CASE WHEN p_asset_type = 'bike' THEN p_asset_id::int ELSE NULL END,
      p_amount,
      COALESCE(p_transaction_date, CURRENT_DATE),
      p_notes,
      p_admin_tg_id,
      NULL,
      'manual_asset',
      1,
      p_amount,
      'CZK',
      true,
      'paid'
    ) RETURNING id INTO v_expense_id;
  END IF;

  INSERT INTO asset_transactions (
    asset_type, asset_id, transaction_type, amount, currency, transaction_date,
    expense_id, notes, created_by_telegram_id
  ) VALUES (
    COALESCE(NULLIF(trim(p_asset_type), ''), 'other'), p_asset_id,
    COALESCE(NULLIF(trim(p_transaction_type), ''), 'purchase'), p_amount, COALESCE(p_currency, 'CZK'),
    COALESCE(p_transaction_date, CURRENT_DATE), v_expense_id, p_notes, p_admin_tg_id
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('transaction_id', v_tx_id, 'expense_id', v_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_asset_bike_purchase(
  p_bike_id bigint,
  p_brand text,
  p_model text,
  p_vin text DEFAULT NULL,
  p_amount numeric DEFAULT 0,
  p_purchase_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx jsonb;
BEGIN
  IF p_bike_id IS NULL OR p_bike_id <= 0 THEN
    RAISE EXCEPTION 'bike_id is required';
  END IF;
  IF COALESCE(trim(p_brand), '') = '' THEN
    RAISE EXCEPTION 'brand is required';
  END IF;
  IF COALESCE(trim(p_model), '') = '' THEN
    RAISE EXCEPTION 'model is required';
  END IF;

  INSERT INTO bikes (id, vin, brand, model, notes, status, created_at, updated_at, purchase_price, purchase_date, asset_status)
  OVERRIDING SYSTEM VALUE
  VALUES (p_bike_id, NULLIF(trim(p_vin), ''), trim(p_brand), trim(p_model), p_notes, 'free', now(), now(), p_amount, COALESCE(p_purchase_date, CURRENT_DATE), 'active')
  ON CONFLICT (id) DO UPDATE SET
    vin = COALESCE(EXCLUDED.vin, bikes.vin),
    brand = EXCLUDED.brand,
    model = EXCLUDED.model,
    notes = trim(both E'\n' from concat_ws(E'\n', bikes.notes, EXCLUDED.notes)),
    updated_at = now(),
    purchase_price = EXCLUDED.purchase_price,
    purchase_date = EXCLUDED.purchase_date,
    asset_status = 'active';

  PERFORM setval(pg_get_serial_sequence('bikes','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM bikes), 1), true);

  IF p_amount > 0 THEN
    v_tx := miniapp_record_asset_expense('bike', p_bike_id, 'purchase', p_amount, p_purchase_date, p_notes, p_admin_tg_id, 'CZK');
  ELSE
    v_tx := jsonb_build_object('transaction_id', null, 'expense_id', null);
  END IF;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_asset_bike_purchase', jsonb_build_object('bike_id', p_bike_id, 'amount', p_amount));
  RETURN jsonb_build_object('bike_id', p_bike_id, 'expense_id', v_tx->>'expense_id', 'transaction_id', v_tx->>'transaction_id');
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_asset_bike_sale(
  p_bike_id bigint,
  p_amount numeric,
  p_sale_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;
  UPDATE bikes
  SET status = 'sold', asset_status = 'sold', sale_price = p_amount, sale_date = COALESCE(p_sale_date, CURRENT_DATE),
      notes = trim(both E'\n' from concat_ws(E'\n', notes, '[sale] ' || p_amount::text || ' Kč ' || COALESCE(p_notes,''))),
      updated_at = now()
  WHERE id = p_bike_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Велик #% не найден.', p_bike_id;
  END IF;

  INSERT INTO asset_transactions(asset_type, asset_id, transaction_type, amount, currency, transaction_date, notes, created_by_telegram_id)
  VALUES ('bike', p_bike_id, 'sale', p_amount, 'CZK', COALESCE(p_sale_date, CURRENT_DATE), p_notes, p_admin_tg_id)
  RETURNING id INTO v_tx_id;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_asset_bike_sale', jsonb_build_object('bike_id', p_bike_id, 'amount', p_amount));
  RETURN jsonb_build_object('bike_id', p_bike_id, 'transaction_id', v_tx_id);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_asset_battery_purchase(
  p_battery_id bigint DEFAULT NULL,
  p_type_id bigint DEFAULT NULL,
  p_bike_id bigint DEFAULT NULL,
  p_amount numeric DEFAULT 0,
  p_purchase_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_battery_id bigint;
  v_tx jsonb;
BEGIN
  IF p_type_id IS NULL THEN
    RAISE EXCEPTION 'type_id is required';
  END IF;

  IF p_battery_id IS NULL THEN
    INSERT INTO batteries(type_id, status, notes, created_at, bike_id, purchase_price, purchase_date, asset_status)
    VALUES (p_type_id, CASE WHEN p_bike_id IS NULL THEN 'free' ELSE 'attached' END, p_notes, now(), p_bike_id::int, p_amount, COALESCE(p_purchase_date, CURRENT_DATE), 'active')
    RETURNING id INTO v_battery_id;
  ELSE
    INSERT INTO batteries(id, type_id, status, notes, created_at, bike_id, purchase_price, purchase_date, asset_status)
    OVERRIDING SYSTEM VALUE
    VALUES (p_battery_id, p_type_id, CASE WHEN p_bike_id IS NULL THEN 'free' ELSE 'attached' END, p_notes, now(), p_bike_id::int, p_amount, COALESCE(p_purchase_date, CURRENT_DATE), 'active')
    ON CONFLICT (id) DO UPDATE SET
      type_id = EXCLUDED.type_id,
      status = EXCLUDED.status,
      notes = trim(both E'\n' from concat_ws(E'\n', batteries.notes, EXCLUDED.notes)),
      bike_id = EXCLUDED.bike_id,
      purchase_price = EXCLUDED.purchase_price,
      purchase_date = EXCLUDED.purchase_date,
      asset_status = 'active'
    RETURNING id INTO v_battery_id;
    PERFORM setval(pg_get_serial_sequence('batteries','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM batteries), 1), true);
  END IF;

  IF p_amount > 0 THEN
    v_tx := miniapp_record_asset_expense('battery', v_battery_id, 'purchase', p_amount, p_purchase_date, p_notes, p_admin_tg_id, 'CZK');
  ELSE
    v_tx := jsonb_build_object('transaction_id', null, 'expense_id', null);
  END IF;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_asset_battery_purchase', jsonb_build_object('battery_id', v_battery_id, 'type_id', p_type_id, 'amount', p_amount));
  RETURN jsonb_build_object('battery_id', v_battery_id, 'expense_id', v_tx->>'expense_id', 'transaction_id', v_tx->>'transaction_id');
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_asset_battery_sale(
  p_battery_id bigint,
  p_amount numeric,
  p_sale_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx_id bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  UPDATE batteries
  SET status = 'sold', asset_status = 'sold', sale_price = p_amount, sale_date = COALESCE(p_sale_date, CURRENT_DATE),
      notes = trim(both E'\n' from concat_ws(E'\n', notes, '[sale] ' || p_amount::text || ' Kč ' || COALESCE(p_notes,'')))
  WHERE id = p_battery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Батарея #% не найдена.', p_battery_id;
  END IF;

  INSERT INTO asset_transactions(asset_type, asset_id, transaction_type, amount, currency, transaction_date, notes, created_by_telegram_id)
  VALUES ('battery', p_battery_id, 'sale', p_amount, 'CZK', COALESCE(p_sale_date, CURRENT_DATE), p_notes, p_admin_tg_id)
  RETURNING id INTO v_tx_id;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_asset_battery_sale', jsonb_build_object('battery_id', p_battery_id, 'amount', p_amount));
  RETURN jsonb_build_object('battery_id', p_battery_id, 'transaction_id', v_tx_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- patch 0.39: client general requests + safer cash stats columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS bot_finance_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE IF EXISTS bot_finance_events ADD COLUMN IF NOT EXISTS affects_cash boolean;
ALTER TABLE IF EXISTS bot_finance_events ADD COLUMN IF NOT EXISTS nominal_amount numeric;
ALTER TABLE IF EXISTS bot_finance_events ADD COLUMN IF NOT EXISTS cash_amount numeric;
ALTER TABLE IF EXISTS bot_finance_events ADD COLUMN IF NOT EXISTS currency text DEFAULT 'CZK';

CREATE TABLE IF NOT EXISTS client_requests (
  id bigserial PRIMARY KEY,
  client_id int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  telegram_id bigint,
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  title text,
  description text NOT NULL,
  preferred_date date,
  admin_note text,
  decided_by_telegram_id bigint,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_requests_status_check CHECK (status IN ('new','in_progress','approved','rejected','closed','cancelled')),
  CONSTRAINT client_requests_type_check CHECK (request_type IN ('rent_request','battery_request','repair_request','payment_rule_request','return_request','accessory_request','other_request'))
);

CREATE INDEX IF NOT EXISTS idx_client_requests_client ON client_requests(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON client_requests(status, created_at DESC);

-- PATCH 0.392: allocate advances for all clients and track non-client business debts.
CREATE OR REPLACE FUNCTION miniapp_allocate_all_advances(
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client record;
  v_result jsonb;
  v_total numeric := 0;
  v_clients int := 0;
BEGIN
  FOR v_client IN
    SELECT DISTINCT client_id
    FROM (
      SELECT client_id FROM client_payments WHERE client_id IS NOT NULL
      UNION
      SELECT client_id FROM client_charges WHERE client_id IS NOT NULL
    ) x
  LOOP
    v_result := miniapp_allocate_client_advance(v_client.client_id, p_admin_tg_id, 'auto');
    IF COALESCE((v_result->>'allocated_amount')::numeric, 0) > 0 THEN
      v_total := v_total + (v_result->>'allocated_amount')::numeric;
      v_clients := v_clients + 1;
    END IF;
  END LOOP;

  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_allocate_all_advances', jsonb_build_object('allocated_amount', v_total, 'clients_count', v_clients));
  RETURN jsonb_build_object('allocated_amount', v_total, 'clients_count', v_clients);
END;
$$;

CREATE TABLE IF NOT EXISTS business_debts (
  id bigserial PRIMARY KEY,
  counterparty_name text NOT NULL,
  direction text NOT NULL DEFAULT 'receivable' CHECK (direction IN ('receivable','payable')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'CZK',
  category text NOT NULL DEFAULT 'other',
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','partial','cancelled','ignored')),
  notes text,
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_debts_status_due ON business_debts(status, due_date);
CREATE INDEX IF NOT EXISTS idx_business_debts_counterparty ON business_debts(counterparty_name);
