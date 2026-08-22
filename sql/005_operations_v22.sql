-- Aligator Rent CRM — Operations v2.2
-- Requires 003_contracts_payments_v2.sql and 004_finance_parser_v3.sql.
-- Safe additive migration: request triage, battery overview, cash-only payment codes,
-- partial cash payments, planned allocations and audit-friendly verification.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Client request triage
-- -----------------------------------------------------------------------------
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS request_subtype text;
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS bike_id bigint;
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS rental_id bigint;
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS quoted_amount numeric(12,2);
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS assigned_admin_telegram_id bigint;
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS resolved_charge_id bigint;
ALTER TABLE public.client_requests ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.client_requests DROP CONSTRAINT IF EXISTS client_requests_priority_check;
ALTER TABLE public.client_requests
  ADD CONSTRAINT client_requests_priority_check
  CHECK (priority IN ('low','normal','high','urgent')) NOT VALID;

ALTER TABLE public.client_requests DROP CONSTRAINT IF EXISTS client_requests_bike_id_fkey;
ALTER TABLE public.client_requests
  ADD CONSTRAINT client_requests_bike_id_fkey
  FOREIGN KEY (bike_id) REFERENCES public.bikes(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE public.client_requests DROP CONSTRAINT IF EXISTS client_requests_rental_id_fkey;
ALTER TABLE public.client_requests
  ADD CONSTRAINT client_requests_rental_id_fkey
  FOREIGN KEY (rental_id) REFERENCES public.rentals(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE public.client_requests DROP CONSTRAINT IF EXISTS client_requests_resolved_charge_id_fkey;
ALTER TABLE public.client_requests
  ADD CONSTRAINT client_requests_resolved_charge_id_fkey
  FOREIGN KEY (resolved_charge_id) REFERENCES public.client_charges(id) ON DELETE SET NULL NOT VALID;

CREATE INDEX IF NOT EXISTS idx_client_requests_ops_v22
  ON public.client_requests(status, request_type, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_requests_bike_v22
  ON public.client_requests(bike_id, status, created_at DESC)
  WHERE bike_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) One-click battery overview.
-- Active battery_rentals is the strongest assignment signal. batteries.bike_id is
-- retained as a legacy/current physical link and surfaced so inconsistencies are visible.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.miniapp_battery_overview_v22 AS
WITH latest_active AS (
  SELECT DISTINCT ON (br.battery_id)
    br.id AS battery_rental_id,
    br.battery_id,
    br.rental_id,
    br.status AS assignment_status,
    br.created_at AS attached_at,
    br.returned_at,
    br.notes AS assignment_notes
  FROM public.battery_rentals br
  WHERE br.status='active'
  ORDER BY br.battery_id, br.created_at DESC, br.id DESC
)
SELECT
  bat.id AS battery_id,
  bat.status AS battery_status,
  bat.bike_id AS legacy_bike_id,
  bat.notes AS battery_notes,
  bt.brand,
  bt.capacity,
  bt.generation,
  bt.compatible_bike_model,
  la.battery_rental_id,
  la.rental_id,
  la.assignment_status,
  la.attached_at,
  r.status AS rental_status,
  r.bike_id AS rental_bike_id,
  COALESCE(r.bike_id, bat.bike_id) AS effective_bike_id,
  b.brand AS bike_brand,
  b.model AS bike_model,
  concat_ws(' ', '#' || b.id::text, b.brand, b.model) AS bike_label,
  r.client_id,
  c.name AS client_name,
  CASE
    WHEN la.battery_rental_id IS NOT NULL AND r.status='active' THEN 'assigned'
    WHEN la.battery_rental_id IS NOT NULL AND COALESCE(r.status,'') <> 'active' THEN 'orphan_assignment'
    WHEN la.battery_rental_id IS NULL AND bat.status='rented' THEN 'rented_without_assignment'
    WHEN la.battery_rental_id IS NULL AND bat.bike_id IS NOT NULL THEN 'legacy_link'
    ELSE 'free'
  END AS overview_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN la.battery_rental_id IS NOT NULL AND COALESCE(r.status,'') <> 'active' THEN 'assignment_to_non_active_rental' END,
    CASE WHEN la.battery_rental_id IS NULL AND bat.status='rented' THEN 'battery_rented_without_active_assignment' END,
    CASE WHEN la.battery_rental_id IS NOT NULL AND bat.status IS DISTINCT FROM 'rented' THEN 'active_assignment_but_battery_not_rented' END,
    CASE WHEN la.battery_rental_id IS NOT NULL AND bat.bike_id IS NOT NULL AND r.bike_id IS DISTINCT FROM bat.bike_id THEN 'legacy_bike_link_differs_from_rental' END
  ], NULL) AS warnings
FROM public.batteries bat
LEFT JOIN public.battery_types bt ON bt.id=bat.type_id
LEFT JOIN latest_active la ON la.battery_id=bat.id
LEFT JOIN public.rentals r ON r.id=la.rental_id
LEFT JOIN public.bikes b ON b.id=COALESCE(r.bike_id, bat.bike_id)
LEFT JOIN public.clients c ON c.id=r.client_id;

-- -----------------------------------------------------------------------------
-- 3) Cash-only code plan.
-- The code verifies a physical cash hand-over. Bank payments remain separate and
-- will later be verified by Fio/API matching.
-- -----------------------------------------------------------------------------
ALTER TABLE public.payment_tokens ADD COLUMN IF NOT EXISTS token_kind text NOT NULL DEFAULT 'generic';

CREATE TABLE IF NOT EXISTS public.payment_token_allocations (
  id bigserial PRIMARY KEY,
  payment_token_id bigint NOT NULL REFERENCES public.payment_tokens(id) ON DELETE CASCADE,
  charge_id bigint NOT NULL REFERENCES public.client_charges(id) ON DELETE CASCADE,
  planned_amount numeric(12,2) NOT NULL CHECK (planned_amount > 0),
  priority int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_token_id, charge_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_token_allocations_token
  ON public.payment_token_allocations(payment_token_id, priority, id);

-- Create a cash code. p_allocations is e.g.
-- [{"charge_id":133,"amount":2500},{"charge_id":134,"amount":1500}]
-- Empty array = unallocated cash advance / other cash payment.
CREATE OR REPLACE FUNCTION public.miniapp_create_cash_token_v22(
  p_client_id bigint,
  p_amount numeric,
  p_allocations jsonb DEFAULT '[]'::jsonb,
  p_created_by_telegram_id bigint DEFAULT NULL,
  p_ttl_hours int DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_item jsonb;
  v_charge public.client_charges%ROWTYPE;
  v_charge_id bigint;
  v_plan_amount numeric;
  v_sum numeric := 0;
  v_priority int := 0;
  v_rental_id bigint;
  v_rental_count int := 0;
  v_result jsonb;
  v_token_id bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма наличных должна быть больше 0';
  END IF;
  IF p_ttl_hours < 1 OR p_ttl_hours > 72 THEN
    RAISE EXCEPTION 'TTL кода должен быть 1..72 часов';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id) THEN
    RAISE EXCEPTION 'Клиент #% не найден', p_client_id;
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'allocations должен быть JSON-массивом';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _cash_token_plan_v22(
    charge_id bigint PRIMARY KEY,
    amount numeric(12,2) NOT NULL,
    rental_id bigint
  ) ON COMMIT DROP;
  TRUNCATE _cash_token_plan_v22;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_charge_id := NULLIF(v_item->>'charge_id','')::bigint;
    v_plan_amount := NULLIF(v_item->>'amount','')::numeric;
    IF v_charge_id IS NULL OR v_plan_amount IS NULL OR v_plan_amount <= 0 THEN
      RAISE EXCEPTION 'Каждая allocation должна иметь charge_id и amount > 0';
    END IF;

    SELECT * INTO v_charge
    FROM public.client_charges
    WHERE id=v_charge_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Начисление #% не найдено', v_charge_id; END IF;
    IF v_charge.client_id <> p_client_id THEN
      RAISE EXCEPTION 'Начисление #% принадлежит другому клиенту', v_charge_id;
    END IF;
    IF v_charge.status NOT IN ('due','partial') OR v_charge.amount <= v_charge.paid_amount THEN
      RAISE EXCEPTION 'Начисление #% уже закрыто', v_charge_id;
    END IF;
    IF v_plan_amount > (v_charge.amount-v_charge.paid_amount)+0.009 THEN
      RAISE EXCEPTION 'По начислению #% осталось % Kč, нельзя запланировать % Kč',
        v_charge_id, v_charge.amount-v_charge.paid_amount, v_plan_amount;
    END IF;

    INSERT INTO _cash_token_plan_v22(charge_id,amount,rental_id)
    VALUES(v_charge_id,v_plan_amount,v_charge.rental_id)
    ON CONFLICT(charge_id) DO UPDATE SET amount=_cash_token_plan_v22.amount+EXCLUDED.amount;
    v_sum := v_sum + v_plan_amount;
  END LOOP;

  IF v_sum > p_amount + 0.009 THEN
    RAISE EXCEPTION 'Распределено % Kč, но код создаётся только на % Kč', v_sum, p_amount;
  END IF;

  SELECT count(DISTINCT rental_id), min(rental_id)
  INTO v_rental_count, v_rental_id
  FROM _cash_token_plan_v22
  WHERE rental_id IS NOT NULL;
  IF v_rental_count <> 1 THEN v_rental_id := NULL; END IF;

  v_result := public.miniapp_create_payment_token(
    p_client_id=>p_client_id,
    p_amount=>p_amount,
    p_purpose=>'payment',
    p_rental_id=>v_rental_id,
    p_charge_id=>NULL,
    p_created_by_telegram_id=>p_created_by_telegram_id,
    p_ttl_hours=>p_ttl_hours
  );
  v_token_id := (v_result->>'id')::bigint;

  UPDATE public.payment_tokens
  SET token_kind='cash',
      metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
        'cash_v22',true,
        'planned_amount',v_sum,
        'advance_expected',GREATEST(p_amount-v_sum,0)
      )
  WHERE id=v_token_id;

  INSERT INTO public.payment_token_allocations(payment_token_id,charge_id,planned_amount,priority)
  SELECT v_token_id, charge_id, amount, row_number() over (ORDER BY charge_id)::int
  FROM _cash_token_plan_v22;

  RETURN v_result || jsonb_build_object(
    'token_kind','cash',
    'planned_amount',v_sum,
    'advance_expected',GREATEST(p_amount-v_sum,0),
    'allocations',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('charge_id',charge_id,'amount',amount) ORDER BY charge_id)
      FROM _cash_token_plan_v22
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.miniapp_cash_token_preview_v22(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v public.payment_tokens%ROWTYPE;
  v_client_name text;
  v_alloc jsonb;
BEGIN
  SELECT * INTO v
  FROM public.payment_tokens
  WHERE token_hash=public.miniapp_payment_code_hash(p_code)
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Код наличных не найден'; END IF;
  IF v.token_kind <> 'cash' THEN RAISE EXCEPTION 'Это не cash-код'; END IF;
  IF v.status='issued' AND v.expires_at <= now() THEN
    UPDATE public.payment_tokens SET status='expired' WHERE id=v.id;
    v.status := 'expired';
  END IF;
  SELECT name INTO v_client_name FROM public.clients WHERE id=v.client_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'charge_id',pta.charge_id,
      'planned_amount',pta.planned_amount,
      'charge_type',ch.charge_type,
      'charge_amount',ch.amount,
      'paid_amount',ch.paid_amount,
      'remaining',GREATEST(ch.amount-ch.paid_amount,0),
      'bike_id',COALESCE(ch.bike_id,r.bike_id),
      'rental_id',ch.rental_id
    ) ORDER BY pta.priority,pta.id),'[]'::jsonb)
  INTO v_alloc
  FROM public.payment_token_allocations pta
  JOIN public.client_charges ch ON ch.id=pta.charge_id
  LEFT JOIN public.rentals r ON r.id=ch.rental_id
  WHERE pta.payment_token_id=v.id;

  RETURN jsonb_build_object(
    'id',v.id,'last4',v.token_last4,'client_id',v.client_id,'client_name',v_client_name,
    'amount',v.amount,'currency',v.currency,'status',v.status,'token_kind',v.token_kind,
    'created_at',v.created_at,'expires_at',v.expires_at,'redeemed_at',v.redeemed_at,
    'payment_id',v.payment_id,'allocations',v_alloc,'metadata',v.metadata
  );
END
$$;

-- Admin confirms the cash actually received. received amount may be lower than the
-- originally expected code amount: debt simply remains partial/due. Excess over the
-- planned allocations becomes an unallocated advance. It never silently moves to an
-- unrelated debt.
CREATE OR REPLACE FUNCTION public.miniapp_redeem_cash_token_v22(
  p_code text,
  p_received_amount numeric,
  p_admin_tg_id bigint DEFAULT NULL,
  p_audit_chat_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_token public.payment_tokens%ROWTYPE;
  v_payment public.client_payments%ROWTYPE;
  v_plan record;
  v_charge public.client_charges%ROWTYPE;
  v_remaining numeric;
  v_apply numeric;
  v_allocated numeric := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_client_name text;
  v_bike_id bigint;
  v_category text;
BEGIN
  SELECT * INTO v_token
  FROM public.payment_tokens
  WHERE token_hash=public.miniapp_payment_code_hash(p_code)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Код наличных не найден'; END IF;
  IF v_token.token_kind <> 'cash' THEN RAISE EXCEPTION 'Это не cash-код'; END IF;
  IF v_token.status='redeemed' THEN
    RETURN jsonb_build_object('already_redeemed',true,'payment_id',v_token.payment_id,'token_id',v_token.id,'status',v_token.status);
  END IF;
  IF v_token.status <> 'issued' THEN RAISE EXCEPTION 'Код имеет статус %',v_token.status; END IF;
  IF v_token.expires_at <= now() THEN
    UPDATE public.payment_tokens SET status='expired' WHERE id=v_token.id;
    RAISE EXCEPTION 'Код наличных истёк';
  END IF;
  IF p_received_amount IS NULL OR p_received_amount <= 0 THEN
    RAISE EXCEPTION 'Фактически полученная сумма должна быть больше 0';
  END IF;

  INSERT INTO public.client_payments(
    client_id,rental_id,charge_id,amount,payment_date,method,notes,
    created_by_telegram_id,created_at,verification_status,verification_source,
    verified_at,verified_by_telegram_id,payment_token_id
  ) VALUES (
    v_token.client_id,v_token.rental_id,NULL,p_received_amount,public.miniapp_prague_today(),
    'cash','[cash_code #'||v_token.id::text||' last4='||v_token.token_last4||']',
    p_admin_tg_id,now(),'verified','cash_code',now(),p_admin_tg_id,v_token.id
  ) RETURNING * INTO v_payment;

  v_remaining := p_received_amount;

  FOR v_plan IN
    SELECT pta.*
    FROM public.payment_token_allocations pta
    WHERE pta.payment_token_id=v_token.id
    ORDER BY pta.priority,pta.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    SELECT * INTO v_charge FROM public.client_charges WHERE id=v_plan.charge_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_charge.client_id <> v_token.client_id THEN CONTINUE; END IF;
    IF v_charge.status NOT IN ('due','partial') OR v_charge.amount <= v_charge.paid_amount THEN CONTINUE; END IF;

    v_apply := LEAST(v_remaining,v_plan.planned_amount,GREATEST(v_charge.amount-v_charge.paid_amount,0));
    IF v_apply <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.miniapp_payment_allocations(payment_id,charge_id,amount,created_by_telegram_id)
    VALUES(v_payment.id,v_charge.id,v_apply,p_admin_tg_id)
    ON CONFLICT(payment_id,charge_id) DO UPDATE SET amount=EXCLUDED.amount;

    UPDATE public.client_charges
    SET paid_amount=paid_amount+v_apply,
        status=CASE WHEN paid_amount+v_apply >= amount THEN 'paid' ELSE 'partial' END,
        paid_at=CASE WHEN paid_amount+v_apply >= amount THEN now() ELSE paid_at END,
        updated_at=now()
    WHERE id=v_charge.id;

    v_category := public.miniapp_charge_category(v_charge.charge_type);
    v_bike_id := v_charge.bike_id;
    IF v_bike_id IS NULL AND v_charge.rental_id IS NOT NULL THEN
      SELECT r.bike_id INTO v_bike_id FROM public.rentals r WHERE r.id=v_charge.rental_id;
    END IF;

    INSERT INTO public.bot_finance_events(
      admin_telegram_id,raw_text,line_text,event_date,sign,amount,category,category_label,
      method,bike_id,rental_id,client_id,payment_id,charge_id,action,currency,event_type,
      affects_cash,nominal_amount,cash_amount,created_at,source_type,source_id,verification_status
    ) VALUES (
      p_admin_tg_id,'cash code ****'||v_token.token_last4,'cash code ****'||v_token.token_last4,
      public.miniapp_prague_today(),'income',v_apply,v_category,public.miniapp_category_label(v_category),
      'cash',v_bike_id,v_charge.rental_id,v_token.client_id,v_payment.id,v_charge.id,'payment','CZK',
      'payment_received',true,v_apply,v_apply,now(),'client_payment',v_payment.id,'verified'
    );

    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'charge_id',v_charge.id,'amount',v_apply,'category',v_category
    ));
    v_allocated := v_allocated+v_apply;
    v_remaining := v_remaining-v_apply;
  END LOOP;

  -- Anything not explicitly planned stays advance/unallocated, but is still real cash.
  IF v_remaining > 0 THEN
    INSERT INTO public.bot_finance_events(
      admin_telegram_id,raw_text,line_text,event_date,sign,amount,category,category_label,
      method,rental_id,client_id,payment_id,action,currency,event_type,affects_cash,
      nominal_amount,cash_amount,created_at,source_type,source_id,verification_status
    ) VALUES (
      p_admin_tg_id,'cash code ****'||v_token.token_last4,'cash advance ****'||v_token.token_last4,
      public.miniapp_prague_today(),'income',v_remaining,'other_income','Аванс / нераспределённая наличка',
      'cash',v_token.rental_id,v_token.client_id,v_payment.id,'payment','CZK','payment_received',true,
      v_remaining,v_remaining,now(),'client_payment',v_payment.id,'verified'
    );
  END IF;

  UPDATE public.payment_tokens
  SET status='redeemed',redeemed_at=now(),redeemed_by_telegram_id=p_admin_tg_id,
      redeemed_source='cash_code',payment_id=v_payment.id,
      metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('received_amount',p_received_amount,'allocated_amount',v_allocated)
  WHERE id=v_token.id;

  INSERT INTO public.payment_verification_events(
    payment_id,payment_token_id,event_type,source,status_before,status_after,actor_telegram_id,details
  ) VALUES (
    v_payment.id,v_token.id,'verified','cash_code',NULL,'verified',p_admin_tg_id,
    jsonb_build_object('expected_amount',v_token.amount,'received_amount',p_received_amount,'allocated_amount',v_allocated,'advance_amount',v_remaining,'allocations',v_allocations)
  );

  IF p_audit_chat_id IS NOT NULL THEN
    SELECT name INTO v_client_name FROM public.clients WHERE id=v_token.client_id;
    INSERT INTO public.telegram_outbox(event_key,event_type,chat_id,payload)
    VALUES(
      'cash_payment_verified:'||v_payment.id::text,'payment_verified',p_audit_chat_id,
      jsonb_build_object('payment_id',v_payment.id,'token_id',v_token.id,'token_last4',v_token.token_last4,
        'amount',p_received_amount,'expected_amount',v_token.amount,'method','cash','client_id',v_token.client_id,
        'client_name',v_client_name,'rental_id',v_token.rental_id,'verification_source','cash_code',
        'allocated_amount',v_allocated,'advance_amount',v_remaining)
    ) ON CONFLICT(event_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'already_redeemed',false,'payment_id',v_payment.id,'token_id',v_token.id,
    'client_id',v_token.client_id,'received_amount',p_received_amount,'expected_amount',v_token.amount,
    'allocated_amount',v_allocated,'advance_amount',v_remaining,'allocations',v_allocations,
    'verification_status','verified','verification_source','cash_code'
  );
END
$$;

-- New data is server-side only. Mini App routes authenticate Telegram and use service_role.
ALTER TABLE public.payment_token_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_token_allocations FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.payment_token_allocations TO service_role;
GRANT SELECT ON TABLE public.miniapp_battery_overview_v22 TO service_role;

REVOKE EXECUTE ON FUNCTION public.miniapp_create_cash_token_v22(bigint,numeric,jsonb,bigint,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_cash_token_preview_v22(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_redeem_cash_token_v22(text,numeric,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.miniapp_create_cash_token_v22(bigint,numeric,jsonb,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_cash_token_preview_v22(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_redeem_cash_token_v22(text,numeric,bigint,bigint) TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
