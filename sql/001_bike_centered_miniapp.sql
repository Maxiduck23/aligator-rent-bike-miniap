-- Aligator Rent CRM Mini App v0.2
-- Bike-centered admin Mini App for Vercel.
-- Run in Supabase SQL Editor.
-- This migration adds views, RPC helpers, and a safe miniapp-only exclusions table.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Views
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW miniapp_clients AS
SELECT
  c.id,
  c.name,
  c.phone,
  c.telegram_id,
  c.payment_status,
  c.notes,
  COALESCE(COUNT(r.id) FILTER (WHERE r.status = 'active'), 0)::int AS active_rentals,
  COALESCE(array_agg(r.bike_id ORDER BY r.bike_id) FILTER (WHERE r.status = 'active'), ARRAY[]::bigint[]) AS active_bike_ids
FROM clients c
LEFT JOIN rentals r ON r.client_id = c.id
GROUP BY c.id, c.name, c.phone, c.telegram_id, c.payment_status, c.notes;

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
  p_admin_tg_id bigint DEFAULT NULL
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

  INSERT INTO clients (name, phone, telegram_id, notes, payment_status, created_at, tg_registered_at)
  VALUES (p_name, p_phone, p_telegram_id, p_notes, 'ok', now(), CASE WHEN p_telegram_id IS NULL THEN NULL ELSE now() END)
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

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM miniapp_audit(p_admin_tg_id, 'miniapp_exclude_charges', jsonb_build_object('charge_ids', p_charge_ids, 'reason', p_reason));
  RETURN jsonb_build_object('excluded_count', v_count, 'charge_ids', p_charge_ids);
END;
$$;

CREATE OR REPLACE FUNCTION miniapp_mark_charges_paid(
  p_charge_ids bigint[],
  p_method text DEFAULT 'manual',
  p_note text DEFAULT 'marked paid from miniapp',
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
    VALUES (ch.client_id, ch.rental_id, ch.id, v_amount, CURRENT_DATE, p_method, p_note, p_admin_tg_id, now())
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
  RETURN jsonb_build_object('rule_id', v_rule.id, 'rental_id', v_rental.id, 'bike_id', p_bike_id, 'sum_parts', v_sum);
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
