-- Aligator Rent CRM v27
-- Asset integrity hardening + role-test support is implemented in Mini App code.
--
-- Goals:
--   1) One physical asset ID cannot be purchased/sold twice.
--   2) Purchase ID may be omitted; DB assigns MAX(id)+1 atomically.
--   3) Double taps/concurrent requests cannot create duplicate purchase/sale rows.
--   4) Rented bikes / assigned batteries cannot be sold accidentally.
--   5) Existing suspicious rows are exposed in a read-only diagnostics view.
--
-- This migration DOES NOT delete or rewrite historical rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.asset_operation_requests_v27 (
  request_key text PRIMARY KEY,
  actor_telegram_id bigint,
  operation_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','done')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_asset_operation_requests_v27_created
  ON public.asset_operation_requests_v27(created_at DESC);

CREATE OR REPLACE FUNCTION public.asset_operation_begin_v27(
  p_request_key text,
  p_actor_telegram_id bigint,
  p_operation_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_status text;
  v_result jsonb;
  v_actor bigint;
  v_operation_type text;
BEGIN
  IF v_key IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.asset_operation_requests_v27(
    request_key, actor_telegram_id, operation_type, status
  ) VALUES (
    v_key, p_actor_telegram_id, p_operation_type, 'processing'
  )
  ON CONFLICT (request_key) DO NOTHING;

  IF FOUND THEN
    RETURN NULL;
  END IF;

  SELECT status, result, actor_telegram_id, operation_type
    INTO v_status, v_result, v_actor, v_operation_type
  FROM public.asset_operation_requests_v27
  WHERE request_key = v_key;

  IF v_actor IS DISTINCT FROM p_actor_telegram_id
     OR v_operation_type IS DISTINCT FROM p_operation_type THEN
    RAISE EXCEPTION 'request_key уже использован другой asset-операцией';
  END IF;

  IF v_status = 'done' AND v_result IS NOT NULL THEN
    RETURN v_result || jsonb_build_object('idempotent_replay', true);
  END IF;

  RAISE EXCEPTION 'Эта asset-операция уже выполняется. Подожди и обнови экран.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.asset_operation_finish_v27(
  p_request_key text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
BEGIN
  IF v_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.asset_operation_requests_v27
  SET status = 'done',
      result = p_result,
      completed_at = now()
  WHERE request_key = v_key;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.asset_operation_begin_v27(text,bigint,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.asset_operation_finish_v27(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_operation_begin_v27(text,bigint,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.asset_operation_finish_v27(text,jsonb) TO postgres, service_role;

-- -----------------------------------------------------------------------------
-- Global guard for current and legacy callers.
-- Existing duplicates remain visible for audit, but new duplicates are rejected.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_asset_transaction_once_v27()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.transaction_type, '')) IN ('purchase', 'sale') THEN
    IF EXISTS (
      SELECT 1
      FROM public.asset_transactions t
      WHERE t.asset_type = NEW.asset_type
        AND t.asset_id = NEW.asset_id
        AND lower(COALESCE(t.transaction_type, '')) = lower(NEW.transaction_type)
        AND (TG_OP = 'INSERT' OR t.id <> NEW.id)
    ) THEN
      RAISE EXCEPTION
        'Операция % для % #% уже существует. Дубликат заблокирован.',
        NEW.transaction_type, NEW.asset_type, NEW.asset_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_asset_transaction_once_v27
ON public.asset_transactions;

CREATE TRIGGER trg_guard_asset_transaction_once_v27
BEFORE INSERT OR UPDATE OF asset_type, asset_id, transaction_type
ON public.asset_transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_asset_transaction_once_v27();

-- -----------------------------------------------------------------------------
-- Bike purchase.
-- NULL p_bike_id => MAX(id)+1 under table lock.
-- No ON CONFLICT UPDATE: an existing bike ID is always an error for PURCHASE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_asset_bike_purchase_v27(
  p_bike_id bigint,
  p_brand text,
  p_model text,
  p_vin text,
  p_amount numeric,
  p_purchase_date date,
  p_notes text,
  p_admin_tg_id bigint,
  p_request_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bike_id bigint;
  v_tx jsonb;
  v_vin text;
  v_seq text;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_existing := public.asset_operation_begin_v27(v_request_key, p_admin_tg_id, 'bike_purchase');
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма покупки должна быть больше 0.';
  END IF;
  IF COALESCE(btrim(p_brand), '') = '' THEN
    RAISE EXCEPTION 'Бренд обязателен.';
  END IF;
  IF COALESCE(btrim(p_model), '') = '' THEN
    RAISE EXCEPTION 'Модель обязательна.';
  END IF;
  IF p_bike_id IS NOT NULL AND p_bike_id <= 0 THEN
    RAISE EXCEPTION 'bike_id должен быть положительным.';
  END IF;

  -- Serializes ID selection and explicit-ID insertion against other v27 purchases.
  LOCK TABLE public.bikes IN SHARE ROW EXCLUSIVE MODE;

  IF p_bike_id IS NULL THEN
    SELECT COALESCE(MAX(id), 0)::bigint + 1
      INTO v_bike_id
    FROM public.bikes;
  ELSE
    v_bike_id := p_bike_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.bikes WHERE id = v_bike_id) THEN
    RAISE EXCEPTION
      'Велик #% уже существует. Покупка НЕ записана. Выбери другой ID или оставь поле пустым.',
      v_bike_id;
  END IF;

  v_vin := NULLIF(btrim(COALESCE(p_vin, '')), '');
  IF v_vin IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.bikes
    WHERE vin IS NOT NULL
      AND lower(btrim(vin)) = lower(v_vin)
  ) THEN
    RAISE EXCEPTION
      'Велик с VIN/серийником "%" уже есть в базе. Покупка НЕ записана.',
      v_vin;
  END IF;

  -- Protect against an old orphan/stale purchase transaction for the chosen ID.
  IF EXISTS (
    SELECT 1
    FROM public.asset_transactions
    WHERE asset_type = 'bike'
      AND asset_id = v_bike_id
      AND lower(COALESCE(transaction_type, '')) = 'purchase'
  ) THEN
    RAISE EXCEPTION
      'Для bike #% уже есть purchase transaction. Сначала проверь старые данные.',
      v_bike_id;
  END IF;

  INSERT INTO public.bikes(
    id, vin, brand, model, notes, status, created_at, updated_at,
    purchase_price, purchase_date, asset_status
  )
  OVERRIDING SYSTEM VALUE
  VALUES(
    v_bike_id,
    v_vin,
    btrim(p_brand),
    btrim(p_model),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'free',
    now(),
    now(),
    p_amount,
    COALESCE(p_purchase_date, CURRENT_DATE),
    'active'
  );

  v_seq := pg_get_serial_sequence('public.bikes', 'id');
  IF v_seq IS NOT NULL THEN
    PERFORM setval(
      v_seq::regclass,
      GREATEST((SELECT COALESCE(MAX(id), 1)::bigint FROM public.bikes), 1),
      true
    );
  END IF;

  -- Existing helper writes business_expenses + asset_transactions in this same DB tx.
  v_tx := public.miniapp_record_asset_expense(
    'bike',
    v_bike_id,
    'purchase',
    p_amount,
    COALESCE(p_purchase_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_admin_tg_id,
    'CZK'
  );

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_asset_bike_purchase_v27',
    jsonb_build_object(
      'bike_id', v_bike_id,
      'amount', p_amount,
      'auto_id', p_bike_id IS NULL,
      'transaction_id', v_tx->>'transaction_id',
      'expense_id', v_tx->>'expense_id'
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'bike_id', v_bike_id,
    'auto_id', p_bike_id IS NULL,
    'expense_id', v_tx->>'expense_id',
    'transaction_id', v_tx->>'transaction_id'
  );
  PERFORM public.asset_operation_finish_v27(v_request_key, v_result);
  RETURN v_result;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Bike sale.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_asset_bike_sale_v27(
  p_bike_id bigint,
  p_amount numeric,
  p_sale_date date,
  p_notes text,
  p_admin_tg_id bigint,
  p_request_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bike public.bikes%ROWTYPE;
  v_tx_id bigint;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_existing := public.asset_operation_begin_v27(v_request_key, p_admin_tg_id, 'bike_sale');
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_bike_id IS NULL OR p_bike_id <= 0 THEN
    RAISE EXCEPTION 'bike_id обязателен для продажи.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма продажи должна быть больше 0.';
  END IF;

  SELECT *
    INTO v_bike
  FROM public.bikes
  WHERE id = p_bike_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Велик #% не найден.', p_bike_id;
  END IF;

  IF lower(COALESCE(v_bike.asset_status, '')) = 'sold'
     OR lower(COALESCE(v_bike.status, '')) = 'sold' THEN
    RAISE EXCEPTION 'Велик #% уже помечен проданным.', p_bike_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rentals
    WHERE bike_id = p_bike_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION
      'У велика #% есть active аренда. Сначала закрой/перенеси договор, потом продавай.',
      p_bike_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asset_transactions
    WHERE asset_type = 'bike'
      AND asset_id = p_bike_id
      AND lower(COALESCE(transaction_type, '')) = 'sale'
  ) THEN
    RAISE EXCEPTION 'Продажа bike #% уже записана.', p_bike_id;
  END IF;

  UPDATE public.bikes
  SET status = 'sold',
      asset_status = 'sold',
      sale_price = p_amount,
      sale_date = COALESCE(p_sale_date, CURRENT_DATE),
      notes = trim(both E'\n' from concat_ws(
        E'\n',
        notes,
        '[sale_v27] ' || p_amount::text || ' Kč ' || COALESCE(p_notes, '')
      )),
      updated_at = now()
  WHERE id = p_bike_id;

  INSERT INTO public.asset_transactions(
    asset_type, asset_id, transaction_type, amount, currency,
    transaction_date, notes, created_by_telegram_id
  )
  VALUES(
    'bike', p_bike_id, 'sale', p_amount, 'CZK',
    COALESCE(p_sale_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_admin_tg_id
  )
  RETURNING id INTO v_tx_id;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_asset_bike_sale_v27',
    jsonb_build_object('bike_id', p_bike_id, 'amount', p_amount, 'transaction_id', v_tx_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'bike_id', p_bike_id,
    'transaction_id', v_tx_id
  );
  PERFORM public.asset_operation_finish_v27(v_request_key, v_result);
  RETURN v_result;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Battery purchase. Admin UI only today, hardened too so the same bug cannot
-- survive in the neighboring asset type.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_asset_battery_purchase_v27(
  p_battery_id bigint,
  p_type_id bigint,
  p_bike_id bigint,
  p_amount numeric,
  p_purchase_date date,
  p_notes text,
  p_admin_tg_id bigint,
  p_request_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_battery_id bigint;
  v_tx jsonb;
  v_seq text;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_existing := public.asset_operation_begin_v27(v_request_key, p_admin_tg_id, 'battery_purchase');
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_type_id IS NULL OR p_type_id <= 0 THEN
    RAISE EXCEPTION 'type_id батареи обязателен.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма покупки должна быть больше 0.';
  END IF;
  IF p_battery_id IS NOT NULL AND p_battery_id <= 0 THEN
    RAISE EXCEPTION 'battery_id должен быть положительным.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.battery_types WHERE id = p_type_id) THEN
    RAISE EXCEPTION 'battery type #% не найден.', p_type_id;
  END IF;
  IF p_bike_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.bikes WHERE id = p_bike_id) THEN
    RAISE EXCEPTION 'Велик #% для привязки батареи не найден.', p_bike_id;
  END IF;

  LOCK TABLE public.batteries IN SHARE ROW EXCLUSIVE MODE;

  IF p_battery_id IS NULL THEN
    SELECT COALESCE(MAX(id), 0)::bigint + 1
      INTO v_battery_id
    FROM public.batteries;
  ELSE
    v_battery_id := p_battery_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.batteries WHERE id = v_battery_id) THEN
    RAISE EXCEPTION
      'Батарея #% уже существует. Покупка НЕ записана. Выбери другой ID или оставь поле пустым.',
      v_battery_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asset_transactions
    WHERE asset_type = 'battery'
      AND asset_id = v_battery_id
      AND lower(COALESCE(transaction_type, '')) = 'purchase'
  ) THEN
    RAISE EXCEPTION
      'Для battery #% уже есть purchase transaction. Сначала проверь старые данные.',
      v_battery_id;
  END IF;

  INSERT INTO public.batteries(
    id, type_id, status, notes, created_at, bike_id,
    purchase_price, purchase_date, asset_status
  )
  OVERRIDING SYSTEM VALUE
  VALUES(
    v_battery_id,
    p_type_id,
    CASE WHEN p_bike_id IS NULL THEN 'free' ELSE 'attached' END,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    now(),
    p_bike_id::int,
    p_amount,
    COALESCE(p_purchase_date, CURRENT_DATE),
    'active'
  );

  v_seq := pg_get_serial_sequence('public.batteries', 'id');
  IF v_seq IS NOT NULL THEN
    PERFORM setval(
      v_seq::regclass,
      GREATEST((SELECT COALESCE(MAX(id), 1)::bigint FROM public.batteries), 1),
      true
    );
  END IF;

  v_tx := public.miniapp_record_asset_expense(
    'battery',
    v_battery_id,
    'purchase',
    p_amount,
    COALESCE(p_purchase_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_admin_tg_id,
    'CZK'
  );

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_asset_battery_purchase_v27',
    jsonb_build_object(
      'battery_id', v_battery_id,
      'type_id', p_type_id,
      'amount', p_amount,
      'auto_id', p_battery_id IS NULL
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'battery_id', v_battery_id,
    'auto_id', p_battery_id IS NULL,
    'expense_id', v_tx->>'expense_id',
    'transaction_id', v_tx->>'transaction_id'
  );
  PERFORM public.asset_operation_finish_v27(v_request_key, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.miniapp_asset_battery_sale_v27(
  p_battery_id bigint,
  p_amount numeric,
  p_sale_date date,
  p_notes text,
  p_admin_tg_id bigint,
  p_request_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_battery public.batteries%ROWTYPE;
  v_tx_id bigint;
  v_request_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_existing := public.asset_operation_begin_v27(v_request_key, p_admin_tg_id, 'battery_sale');
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_battery_id IS NULL OR p_battery_id <= 0 THEN
    RAISE EXCEPTION 'battery_id обязателен для продажи.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Сумма продажи должна быть больше 0.';
  END IF;

  SELECT *
    INTO v_battery
  FROM public.batteries
  WHERE id = p_battery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Батарея #% не найдена.', p_battery_id;
  END IF;

  IF lower(COALESCE(v_battery.asset_status, '')) = 'sold'
     OR lower(COALESCE(v_battery.status, '')) = 'sold' THEN
    RAISE EXCEPTION 'Батарея #% уже помечена проданной.', p_battery_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.battery_rentals
    WHERE battery_id = p_battery_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION
      'Батарея #% сейчас выдана в active rental. Сначала сними её с договора.',
      p_battery_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.asset_transactions
    WHERE asset_type = 'battery'
      AND asset_id = p_battery_id
      AND lower(COALESCE(transaction_type, '')) = 'sale'
  ) THEN
    RAISE EXCEPTION 'Продажа battery #% уже записана.', p_battery_id;
  END IF;

  UPDATE public.batteries
  SET status = 'sold',
      asset_status = 'sold',
      sale_price = p_amount,
      sale_date = COALESCE(p_sale_date, CURRENT_DATE),
      notes = trim(both E'\n' from concat_ws(
        E'\n',
        notes,
        '[sale_v27] ' || p_amount::text || ' Kč ' || COALESCE(p_notes, '')
      ))
  WHERE id = p_battery_id;

  INSERT INTO public.asset_transactions(
    asset_type, asset_id, transaction_type, amount, currency,
    transaction_date, notes, created_by_telegram_id
  )
  VALUES(
    'battery', p_battery_id, 'sale', p_amount, 'CZK',
    COALESCE(p_sale_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_admin_tg_id
  )
  RETURNING id INTO v_tx_id;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_asset_battery_sale_v27',
    jsonb_build_object('battery_id', p_battery_id, 'amount', p_amount, 'transaction_id', v_tx_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'battery_id', p_battery_id,
    'transaction_id', v_tx_id
  );
  PERFORM public.asset_operation_finish_v27(v_request_key, v_result);
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.miniapp_asset_bike_purchase_v27(
  bigint,text,text,text,numeric,date,text,bigint,text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_asset_bike_sale_v27(
  bigint,numeric,date,text,bigint,text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_asset_battery_purchase_v27(
  bigint,bigint,bigint,numeric,date,text,bigint,text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_asset_battery_sale_v27(
  bigint,numeric,date,text,bigint,text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.miniapp_asset_bike_purchase_v27(
  bigint,text,text,text,numeric,date,text,bigint,text
) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_asset_bike_sale_v27(
  bigint,numeric,date,text,bigint,text
) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_asset_battery_purchase_v27(
  bigint,bigint,bigint,numeric,date,text,bigint,text
) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_asset_battery_sale_v27(
  bigint,numeric,date,text,bigint,text
) TO postgres, service_role;

-- -----------------------------------------------------------------------------
-- Existing-data diagnostics. Nothing here mutates historical rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.miniapp_asset_integrity_issues_v27 AS
SELECT
  'duplicate_transaction'::text AS issue_type,
  t.asset_type,
  t.asset_id::bigint,
  lower(t.transaction_type)::text AS detail_type,
  COUNT(*)::bigint AS issue_count,
  ('Повторных ' || lower(t.transaction_type) || ': ' || COUNT(*)::text)::text AS description
FROM public.asset_transactions t
WHERE lower(COALESCE(t.transaction_type, '')) IN ('purchase', 'sale')
GROUP BY t.asset_type, t.asset_id, lower(t.transaction_type)
HAVING COUNT(*) > 1

UNION ALL

SELECT
  'orphan_asset_transaction',
  t.asset_type,
  t.asset_id::bigint,
  lower(COALESCE(t.transaction_type, 'unknown')),
  1::bigint,
  'asset_transaction ссылается на отсутствующий актив'
FROM public.asset_transactions t
WHERE (t.asset_type = 'bike' AND NOT EXISTS (
         SELECT 1 FROM public.bikes b WHERE b.id = t.asset_id
       ))
   OR (t.asset_type = 'battery' AND NOT EXISTS (
         SELECT 1 FROM public.batteries b WHERE b.id = t.asset_id
       ))

UNION ALL

SELECT
  'sold_bike_with_active_rental',
  'bike',
  b.id::bigint,
  'active_rental',
  COUNT(r.id)::bigint,
  'Велик sold, но на нём осталась active аренда'
FROM public.bikes b
JOIN public.rentals r ON r.bike_id = b.id AND r.status = 'active'
WHERE lower(COALESCE(b.asset_status, '')) = 'sold'
   OR lower(COALESCE(b.status, '')) = 'sold'
GROUP BY b.id

UNION ALL

SELECT
  'sold_battery_with_active_assignment',
  'battery',
  b.id::bigint,
  'active_battery_rental',
  COUNT(br.id)::bigint,
  'Батарея sold, но осталась в active battery_rentals'
FROM public.batteries b
JOIN public.battery_rentals br ON br.battery_id = b.id AND br.status = 'active'
WHERE lower(COALESCE(b.asset_status, '')) = 'sold'
   OR lower(COALESCE(b.status, '')) = 'sold'
GROUP BY b.id

UNION ALL

SELECT
  'duplicate_bike_vin',
  'bike',
  MIN(b.id)::bigint,
  lower(btrim(b.vin)),
  COUNT(*)::bigint,
  'Одинаковый VIN/серийник у нескольких велосипедов'
FROM public.bikes b
WHERE NULLIF(btrim(COALESCE(b.vin, '')), '') IS NOT NULL
GROUP BY lower(btrim(b.vin))
HAVING COUNT(*) > 1;

COMMIT;
