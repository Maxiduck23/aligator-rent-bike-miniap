-- Aligator Rent CRM: tariff contracts + soft battery indexing
-- Apply in Supabase SQL Editor after the current Mini App migration.
-- Additive migration: existing rentals/payment rules remain valid.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.battery_inventory_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.temporary_battery_code_seq START 1;

CREATE TABLE IF NOT EXISTS public.rental_plans (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  first_period_rent numeric NOT NULL CHECK (first_period_rent > 0),
  recurring_rent numeric NOT NULL CHECK (recurring_rent > 0),
  deposit_amount numeric NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  included_batteries int NOT NULL DEFAULT 1 CHECK (included_batteries >= 0),
  included_chargers int NOT NULL DEFAULT 1 CHECK (included_chargers >= 0),
  minimum_months int NOT NULL DEFAULT 1 CHECK (minimum_months >= 1),
  extra_battery_monthly_fee numeric NOT NULL DEFAULT 1500 CHECK (extra_battery_monthly_fee >= 0),
  transition_plan_code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_plan_steps (
  id bigserial PRIMARY KEY,
  plan_id bigint NOT NULL REFERENCES public.rental_plans(id) ON DELETE CASCADE,
  step_number int NOT NULL,
  offset_days int NOT NULL CHECK (offset_days >= 0),
  amount numeric NOT NULL CHECK (amount > 0),
  charge_type text NOT NULL CHECK (charge_type IN ('rent', 'deposit')),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, step_number)
);

CREATE TABLE IF NOT EXISTS public.rental_equipment_events (
  id bigserial PRIMARY KEY,
  rental_id bigint NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  equipment_type text NOT NULL,
  equipment_id bigint,
  action text NOT NULL CHECK (action IN ('issued','returned','replaced','indexed','lost')),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  fee_amount numeric NOT NULL DEFAULT 0,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by_telegram_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_equipment_events_rental
  ON public.rental_equipment_events(rental_id, created_at DESC);

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS plan_id bigint REFERENCES public.rental_plans(id),
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS plan_name text,
  ADD COLUMN IF NOT EXISTS first_period_rent numeric,
  ADD COLUMN IF NOT EXISTS recurring_rent numeric,
  ADD COLUMN IF NOT EXISTS minimum_end_date date,
  ADD COLUMN IF NOT EXISTS included_batteries int,
  ADD COLUMN IF NOT EXISTS extra_batteries int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_battery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_terms_snapshot jsonb;

ALTER TABLE public.batteries
  ADD COLUMN IF NOT EXISTS inventory_code text,
  ADD COLUMN IF NOT EXISTS indexing_status text NOT NULL DEFAULT 'indexed',
  ADD COLUMN IF NOT EXISTS temporary_label text,
  ADD COLUMN IF NOT EXISTS created_from_rental_id bigint REFERENCES public.rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz,
  ADD COLUMN IF NOT EXISTS indexed_by_telegram_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'batteries_indexing_status_check'
  ) THEN
    ALTER TABLE public.batteries
      ADD CONSTRAINT batteries_indexing_status_check
      CHECK (indexing_status IN ('indexed','temporary','needs_review'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS batteries_inventory_code_unique
  ON public.batteries(inventory_code)
  WHERE inventory_code IS NOT NULL;

INSERT INTO public.rental_plans (
  code, name, description, first_period_rent, recurring_rent,
  deposit_amount, included_batteries, included_chargers, minimum_months,
  extra_battery_monthly_fee, transition_plan_code
)
VALUES
  ('monthly_1_battery', 'Подработка', '1 аккумулятор, один платёж', 4500, 4500, 1500, 1, 1, 1, 1500, NULL),
  ('monthly_2_batteries', 'Стандартный', '2 аккумулятора, один платёж', 6000, 6000, 1500, 2, 2, 1, 1500, NULL),
  ('flexible_start', 'Гибкая оплата', '3500 сейчас, залог через 7 дней, 3500 через 14 дней', 7000, 6000, 1500, 2, 2, 1, 1500, 'monthly_2_batteries'),
  ('easy_start', 'Лёгкий старт', '1500 аренда + 1000 залог сейчас, затем 3 платежа по 2200', 8100, 6000, 1000, 2, 2, 1, 1500, 'monthly_2_batteries')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  first_period_rent = EXCLUDED.first_period_rent,
  recurring_rent = EXCLUDED.recurring_rent,
  deposit_amount = EXCLUDED.deposit_amount,
  included_batteries = EXCLUDED.included_batteries,
  included_chargers = EXCLUDED.included_chargers,
  minimum_months = EXCLUDED.minimum_months,
  extra_battery_monthly_fee = EXCLUDED.extra_battery_monthly_fee,
  transition_plan_code = EXCLUDED.transition_plan_code,
  updated_at = now();

DELETE FROM public.rental_plan_steps
WHERE plan_id IN (
  SELECT id FROM public.rental_plans
  WHERE code IN ('monthly_1_battery','monthly_2_batteries','flexible_start','easy_start')
);

INSERT INTO public.rental_plan_steps(plan_id, step_number, offset_days, amount, charge_type, label)
SELECT id, 1, 0, 4500, 'rent', 'Аренда за первый период'
FROM public.rental_plans WHERE code='monthly_1_battery'
UNION ALL
SELECT id, 2, 0, 1500, 'deposit', 'Возвратный залог'
FROM public.rental_plans WHERE code='monthly_1_battery'
UNION ALL
SELECT id, 1, 0, 6000, 'rent', 'Аренда за первый период'
FROM public.rental_plans WHERE code='monthly_2_batteries'
UNION ALL
SELECT id, 2, 0, 1500, 'deposit', 'Возвратный залог'
FROM public.rental_plans WHERE code='monthly_2_batteries'
UNION ALL
SELECT id, 1, 0, 3500, 'rent', 'Первая часть аренды'
FROM public.rental_plans WHERE code='flexible_start'
UNION ALL
SELECT id, 2, 7, 1500, 'deposit', 'Возвратный залог'
FROM public.rental_plans WHERE code='flexible_start'
UNION ALL
SELECT id, 3, 14, 3500, 'rent', 'Вторая часть аренды'
FROM public.rental_plans WHERE code='flexible_start'
UNION ALL
SELECT id, 1, 0, 1500, 'rent', 'Стартовая часть аренды'
FROM public.rental_plans WHERE code='easy_start'
UNION ALL
SELECT id, 2, 0, 1000, 'deposit', 'Возвратный залог'
FROM public.rental_plans WHERE code='easy_start'
UNION ALL
SELECT id, 3, 7, 2200, 'rent', 'Еженедельный платёж 1'
FROM public.rental_plans WHERE code='easy_start'
UNION ALL
SELECT id, 4, 14, 2200, 'rent', 'Еженедельный платёж 2'
FROM public.rental_plans WHERE code='easy_start'
UNION ALL
SELECT id, 5, 21, 2200, 'rent', 'Еженедельный платёж 3'
FROM public.rental_plans WHERE code='easy_start';

CREATE OR REPLACE FUNCTION public.miniapp_next_battery_code(p_temporary boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_temporary THEN
    RETURN 'TMP-BAT-' || lpad(nextval('public.temporary_battery_code_seq')::text, 5, '0');
  END IF;
  RETURN 'BAT-' || lpad(nextval('public.battery_inventory_code_seq')::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_attach_contract_battery(
  p_rental_id bigint,
  p_bike_id bigint,
  p_slot jsonb,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mode text := lower(coalesce(p_slot->>'mode', ''));
  v_battery_id bigint;
  v_type_id bigint;
  v_code text;
  v_temp boolean;
BEGIN
  IF v_mode = 'existing' THEN
    v_battery_id := (p_slot->>'battery_id')::bigint;

    IF NOT EXISTS (SELECT 1 FROM public.batteries WHERE id=v_battery_id AND asset_status='active') THEN
      RAISE EXCEPTION 'Батарея #% не найдена или неактивна.', v_battery_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.battery_rentals
      WHERE battery_id=v_battery_id AND status='active'
    ) THEN
      RAISE EXCEPTION 'Батарея #% уже находится в active-договоре.', v_battery_id;
    END IF;

    UPDATE public.batteries
    SET bike_id=p_bike_id, status='rented',
        first_used_at=coalesce(first_used_at, now())
    WHERE id=v_battery_id;
  ELSIF v_mode IN ('create','temporary') THEN
    v_type_id := nullif(p_slot->>'type_id','')::bigint;
    IF v_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.battery_types WHERE id=v_type_id) THEN
      RAISE EXCEPTION 'Для новой/временной батареи нужен существующий type_id.';
    END IF;

    v_temp := v_mode='temporary';
    v_code := public.miniapp_next_battery_code(v_temp);

    INSERT INTO public.batteries(
      type_id, bike_id, status, notes, first_used_at,
      health_status, asset_status, inventory_code, indexing_status,
      temporary_label, created_from_rental_id, indexed_at,
      indexed_by_telegram_id, created_at
    )
    VALUES(
      v_type_id, p_bike_id, 'rented', nullif(p_slot->>'note',''), now(),
      'unknown', 'active', v_code,
      CASE WHEN v_temp THEN 'temporary' ELSE 'indexed' END,
      CASE WHEN v_temp THEN v_code ELSE NULL END,
      p_rental_id,
      CASE WHEN v_temp THEN NULL ELSE now() END,
      CASE WHEN v_temp THEN NULL ELSE p_admin_tg_id END,
      now()
    )
    RETURNING id INTO v_battery_id;
  ELSE
    RAISE EXCEPTION 'battery slot mode должен быть existing, create или temporary.';
  END IF;

  INSERT INTO public.battery_rentals(rental_id, battery_id, status, created_at, notes)
  VALUES(p_rental_id, v_battery_id, 'active', now(), 'attached by rental contract')
  ON CONFLICT (rental_id, battery_id) DO NOTHING;

  INSERT INTO public.rental_equipment_events(
    rental_id, equipment_type, equipment_id, action, fee_amount,
    effective_date, notes, created_by_telegram_id
  )
  VALUES(
    p_rental_id, 'battery', v_battery_id, 'issued', 0,
    CURRENT_DATE, 'battery slot mode=' || v_mode, p_admin_tg_id
  );

  RETURN v_battery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_create_rental_contract(
  p_bike_id bigint,
  p_client_id bigint,
  p_plan_code text,
  p_start_date date DEFAULT CURRENT_DATE,
  p_batteries jsonb DEFAULT '[]'::jsonb,
  p_charger_quantity int DEFAULT NULL,
  p_extra_battery_count int DEFAULT 0,
  p_initial_payment numeric DEFAULT 0,
  p_payment_method text DEFAULT 'manual',
  p_notes text DEFAULT NULL,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan public.rental_plans%ROWTYPE;
  v_rental public.rentals%ROWTYPE;
  v_slot jsonb;
  v_required int;
  v_recurring_total numeric;
  v_charge_id bigint;
  v_payment_id bigint;
  v_remaining numeric;
  v_alloc numeric;
  v_charge record;
  v_charge_ids bigint[] := ARRAY[]::bigint[];
  v_battery_ids bigint[] := ARRAY[]::bigint[];
  v_battery_id bigint;
  v_rule_id bigint;
  v_due_day int;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_plan
  FROM public.rental_plans
  WHERE code=p_plan_code AND is_active=true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Активный тариф % не найден.', p_plan_code;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rentals
    WHERE bike_id=p_bike_id AND status='active'
  ) THEN
    RAISE EXCEPTION 'У велика #% уже есть active-аренда.', p_bike_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bikes WHERE id=p_bike_id AND asset_status='active') THEN
    RAISE EXCEPTION 'Велик #% не найден или неактивен.', p_bike_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id) THEN
    RAISE EXCEPTION 'Клиент #% не найден.', p_client_id;
  END IF;

  IF jsonb_typeof(p_batteries) <> 'array' THEN
    RAISE EXCEPTION 'batteries должен быть JSON-массивом.';
  END IF;

  IF p_extra_battery_count < 0 THEN
    RAISE EXCEPTION 'extra_battery_count не может быть отрицательным.';
  END IF;

  v_required := v_plan.included_batteries + p_extra_battery_count;
  IF jsonb_array_length(p_batteries) <> v_required THEN
    RAISE EXCEPTION 'Тариф требует % батарей: включено %, дополнительных %. Передано слотов %.',
      v_required, v_plan.included_batteries, p_extra_battery_count, jsonb_array_length(p_batteries);
  END IF;

  v_recurring_total := v_plan.recurring_rent +
    p_extra_battery_count * v_plan.extra_battery_monthly_fee;

  v_snapshot := jsonb_build_object(
    'plan_code', v_plan.code,
    'plan_name', v_plan.name,
    'first_period_rent', v_plan.first_period_rent,
    'recurring_rent', v_plan.recurring_rent,
    'deposit', v_plan.deposit_amount,
    'minimum_months', v_plan.minimum_months,
    'included_batteries', v_plan.included_batteries,
    'extra_batteries', p_extra_battery_count,
    'extra_battery_monthly_fee', v_plan.extra_battery_monthly_fee,
    'included_chargers', v_plan.included_chargers,
    'equipment', jsonb_build_object(
      'alarm', true, 'lock', true, 'gps', true,
      'phone_holder', true, 'handlebar_gloves', true,
      'chargers', coalesce(p_charger_quantity, v_plan.included_chargers)
    )
  );

  INSERT INTO public.rentals(
    bike_id, client_id, price, start_date, status, notes, created_at,
    rental_type, deposit, charger_quantity, plan_id, plan_code, plan_name,
    first_period_rent, recurring_rent, minimum_end_date,
    included_batteries, extra_batteries, extra_battery_fee,
    contract_terms_snapshot
  )
  VALUES(
    p_bike_id, p_client_id, v_recurring_total, p_start_date, 'active',
    p_notes, now(), 'tariff_contract', v_plan.deposit_amount,
    coalesce(p_charger_quantity, v_plan.included_chargers),
    v_plan.id, v_plan.code, v_plan.name,
    v_plan.first_period_rent, v_recurring_total,
    (p_start_date + make_interval(months => v_plan.minimum_months))::date,
    v_plan.included_batteries, p_extra_battery_count,
    p_extra_battery_count * v_plan.extra_battery_monthly_fee,
    v_snapshot
  )
  RETURNING * INTO v_rental;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(p_batteries)
  LOOP
    v_battery_id := public.miniapp_attach_contract_battery(
      v_rental.id, p_bike_id, v_slot, p_admin_tg_id
    );
    v_battery_ids := array_append(v_battery_ids, v_battery_id);
  END LOOP;

  FOR v_charge IN
    SELECT * FROM public.rental_plan_steps
    WHERE plan_id=v_plan.id
    ORDER BY step_number
  LOOP
    INSERT INTO public.client_charges(
      client_id, rental_id, bike_id, charge_type, amount, due_date,
      status, paid_amount, notes, period_start, period_end,
      created_at, updated_at
    )
    VALUES(
      p_client_id, v_rental.id, p_bike_id, v_charge.charge_type,
      v_charge.amount, p_start_date + v_charge.offset_days,
      'due', 0,
      '[contract_plan] plan=' || v_plan.code || '; step=' || v_charge.step_number || '; ' || v_charge.label,
      p_start_date,
      (p_start_date + interval '1 month - 1 day')::date,
      now(), now()
    )
    RETURNING id INTO v_charge_id;
    v_charge_ids := array_append(v_charge_ids, v_charge_id);
  END LOOP;

  IF p_extra_battery_count > 0 THEN
    INSERT INTO public.client_charges(
      client_id, rental_id, bike_id, charge_type, amount, due_date,
      status, paid_amount, notes, period_start, period_end,
      created_at, updated_at
    )
    VALUES(
      p_client_id, v_rental.id, p_bike_id, 'battery',
      p_extra_battery_count * v_plan.extra_battery_monthly_fee,
      p_start_date, 'due', 0,
      '[contract_extra_battery] count=' || p_extra_battery_count,
      p_start_date,
      (p_start_date + interval '1 month - 1 day')::date,
      now(), now()
    )
    RETURNING id INTO v_charge_id;
    v_charge_ids := array_append(v_charge_ids, v_charge_id);
  END IF;

  -- Recurring rule starts from the next contract month.
  v_due_day := extract(day from p_start_date)::int;
  UPDATE public.payment_rules
  SET is_active=false, updated_at=now()
  WHERE rental_id=v_rental.id AND is_active=true;

  INSERT INTO public.payment_rules(
    client_id, rental_id, is_active, weekly_amount, split_mode,
    remind_client, remind_admin, admin_only, grace_days, notes,
    monthly_amount, period_type, min_period_amount,
    allow_client_edit, requires_admin_approval, created_at
  )
  VALUES(
    p_client_id, v_rental.id, true, v_recurring_total, 'monthly_parts',
    true, true, false, 0,
    '[contract_recurring] plan=' || v_plan.code || '; starts next contract month',
    v_recurring_total, 'monthly', v_recurring_total,
    false, true, now()
  )
  RETURNING id INTO v_rule_id;

  INSERT INTO public.payment_rule_parts(rule_id, part_number, due_day, amount)
  VALUES(v_rule_id, 1, v_due_day, v_recurring_total);

  IF coalesce(p_initial_payment,0) > 0 THEN
    INSERT INTO public.client_payments(
      client_id, rental_id, charge_id, amount, payment_date, method,
      notes, created_by_telegram_id, created_at
    )
    VALUES(
      p_client_id, v_rental.id, NULL, p_initial_payment, p_start_date,
      coalesce(nullif(trim(p_payment_method),''),'manual'),
      '[contract_initial_payment]', p_admin_tg_id, now()
    )
    RETURNING id INTO v_payment_id;

    v_remaining := p_initial_payment;

    FOR v_charge IN
      SELECT *
      FROM public.client_charges
      WHERE id=ANY(v_charge_ids)
      ORDER BY due_date, CASE WHEN charge_type='rent' THEN 0 WHEN charge_type='deposit' THEN 1 ELSE 2 END, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := least(v_remaining, v_charge.amount - v_charge.paid_amount);

      INSERT INTO public.miniapp_payment_allocations(
        payment_id, charge_id, amount, created_by_telegram_id
      )
      VALUES(v_payment_id, v_charge.id, v_alloc, p_admin_tg_id)
      ON CONFLICT (payment_id, charge_id)
      DO UPDATE SET amount=public.miniapp_payment_allocations.amount + EXCLUDED.amount;

      UPDATE public.client_charges
      SET paid_amount=paid_amount + v_alloc,
          status=CASE WHEN paid_amount + v_alloc >= amount THEN 'paid' ELSE 'partial' END,
          paid_at=CASE WHEN paid_amount + v_alloc >= amount THEN now() ELSE paid_at END,
          updated_at=now()
      WHERE id=v_charge.id;

      v_remaining := v_remaining - v_alloc;
    END LOOP;
  END IF;

  UPDATE public.bikes
  SET status='rented', updated_at=now()
  WHERE id=p_bike_id;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_create_rental_contract',
    jsonb_build_object(
      'rental_id', v_rental.id,
      'bike_id', p_bike_id,
      'client_id', p_client_id,
      'plan_code', v_plan.code,
      'battery_ids', v_battery_ids,
      'charge_ids', v_charge_ids,
      'initial_payment', p_initial_payment
    )
  );

  RETURN jsonb_build_object(
    'rental', to_jsonb(v_rental),
    'plan', to_jsonb(v_plan),
    'battery_ids', v_battery_ids,
    'charge_ids', v_charge_ids,
    'payment_id', v_payment_id,
    'unallocated_advance', coalesce(v_remaining,0),
    'recurring_rule_id', v_rule_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_add_contract_battery(
  p_rental_id bigint,
  p_battery jsonb,
  p_effective_date date DEFAULT CURRENT_DATE,
  p_charge_now boolean DEFAULT true,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_plan public.rental_plans%ROWTYPE;
  v_battery_id bigint;
  v_fee numeric;
  v_charge_id bigint;
BEGIN
  SELECT * INTO v_rental
  FROM public.rentals
  WHERE id=p_rental_id AND status='active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active-договор #% не найден.', p_rental_id;
  END IF;

  SELECT * INTO v_plan FROM public.rental_plans WHERE id=v_rental.plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'У договора нет тарифного плана. Используй ручной режим.';
  END IF;

  v_fee := v_plan.extra_battery_monthly_fee;
  v_battery_id := public.miniapp_attach_contract_battery(
    v_rental.id, v_rental.bike_id, p_battery, p_admin_tg_id
  );

  UPDATE public.rentals
  SET extra_batteries=extra_batteries + 1,
      extra_battery_fee=extra_battery_fee + v_fee,
      recurring_rent=recurring_rent + v_fee,
      price=price + v_fee,
      contract_terms_snapshot=jsonb_set(
        coalesce(contract_terms_snapshot,'{}'::jsonb),
        '{extra_batteries}',
        to_jsonb(extra_batteries + 1),
        true
      )
  WHERE id=v_rental.id;

  UPDATE public.payment_rules
  SET monthly_amount=coalesce(monthly_amount,0) + v_fee,
      weekly_amount=coalesce(weekly_amount,0) + v_fee,
      min_period_amount=coalesce(min_period_amount,0) + v_fee,
      updated_at=now()
  WHERE rental_id=v_rental.id AND is_active=true;

  UPDATE public.payment_rule_parts
  SET amount=amount + v_fee
  WHERE rule_id=(
    SELECT id FROM public.payment_rules
    WHERE rental_id=v_rental.id AND is_active=true
    ORDER BY id DESC LIMIT 1
  )
  AND part_number=1;

  IF p_charge_now THEN
    INSERT INTO public.client_charges(
      client_id, rental_id, bike_id, charge_type, amount, due_date,
      status, paid_amount, notes, period_start, period_end,
      created_at, updated_at
    )
    VALUES(
      v_rental.client_id, v_rental.id, v_rental.bike_id, 'battery',
      v_fee, p_effective_date, 'due', 0,
      '[extra_battery] battery_id=' || v_battery_id,
      p_effective_date,
      (p_effective_date + interval '1 month - 1 day')::date,
      now(), now()
    )
    RETURNING id INTO v_charge_id;
  END IF;

  INSERT INTO public.rental_equipment_events(
    rental_id, equipment_type, equipment_id, action, fee_amount,
    effective_date, notes, created_by_telegram_id
  )
  VALUES(
    v_rental.id, 'battery', v_battery_id, 'issued', v_fee,
    p_effective_date,
    CASE WHEN p_charge_now THEN 'charged now' ELSE 'fee starts next period' END,
    p_admin_tg_id
  );

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_add_contract_battery',
    jsonb_build_object(
      'rental_id', v_rental.id,
      'battery_id', v_battery_id,
      'fee', v_fee,
      'charge_now', p_charge_now,
      'charge_id', v_charge_id
    )
  );

  RETURN jsonb_build_object(
    'rental_id', v_rental.id,
    'battery_id', v_battery_id,
    'fee', v_fee,
    'charge_id', v_charge_id,
    'charge_now', p_charge_now
  );
END;
$$;

CREATE OR REPLACE VIEW public.miniapp_rental_contracts AS
SELECT
  r.id AS rental_id,
  r.bike_id,
  r.client_id,
  c.name AS client_name,
  r.start_date,
  r.minimum_end_date,
  r.status,
  r.plan_code,
  r.plan_name,
  r.first_period_rent,
  r.recurring_rent,
  r.deposit,
  r.included_batteries,
  r.extra_batteries,
  r.extra_battery_fee,
  r.charger_quantity,
  r.contract_terms_snapshot,
  count(br.id) FILTER (WHERE br.status='active')::int AS active_battery_count,
  count(br.id) FILTER (
    WHERE br.status='active' AND bat.indexing_status='temporary'
  )::int AS temporary_battery_count,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'battery_id', bat.id,
        'inventory_code', bat.inventory_code,
        'indexing_status', bat.indexing_status,
        'type_id', bat.type_id,
        'status', bat.status
      )
      ORDER BY bat.id
    ) FILTER (WHERE br.id IS NOT NULL AND br.status='active'),
    '[]'::jsonb
  ) AS batteries
FROM public.rentals r
JOIN public.clients c ON c.id=r.client_id
LEFT JOIN public.battery_rentals br ON br.rental_id=r.id
LEFT JOIN public.batteries bat ON bat.id=br.battery_id
GROUP BY r.id, c.name;

COMMIT;
