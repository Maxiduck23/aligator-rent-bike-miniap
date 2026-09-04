-- Aligator Rent CRM v2.5
-- Payment undo integrity:
--   * manual/Telegram typo payments are hard-deleted atomically;
--   * bank/token/external payments are kept and soft-reversed;
--   * charges are rebuilt from the remaining effective distribution;
--   * only a compact technical audit row is kept for hard deletes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_undo_audit_v25 (
  id bigserial PRIMARY KEY,
  payment_id bigint NOT NULL,
  client_id integer,
  rental_id integer,
  amount numeric,
  method text,
  undo_mode text NOT NULL,
  source text,
  reason text,
  deleted_by_telegram_id bigint,
  finance_event_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
  affected_charge_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_undo_audit_v25_payment
  ON public.payment_undo_audit_v25(payment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.miniapp_undo_payment_v25(
  p_payment_id bigint,
  p_admin_tg_id bigint DEFAULT NULL,
  p_reason text DEFAULT 'ошибочная оплата',
  p_source text DEFAULT 'admin',
  p_finance_event_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.client_payments%ROWTYPE;
  v_reason text;
  v_external boolean := false;
  v_charge_ids bigint[] := ARRAY[]::bigint[];
  v_finance_ids bigint[] := ARRAY[]::bigint[];
  v_charge_id bigint;
  v_allocations_removed int := 0;
  v_finance_events_affected int := 0;
  v_method text;
  v_verification_source text;
BEGIN
  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'ошибочная оплата');

  SELECT *
    INTO v_payment
  FROM public.client_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'not_found', true,
      'payment_id', p_payment_id
    );
  END IF;

  v_method := lower(COALESCE(v_payment.method, ''));
  v_verification_source := lower(COALESCE(v_payment.verification_source, ''));

  -- Anything tied to a real external transaction stays in history.
  -- Also protect manually labelled bank/Fio/card/POS rows even if an old importer
  -- did not populate external_transaction_id.
  v_external :=
       v_payment.external_transaction_id IS NOT NULL
    OR v_payment.payment_token_id IS NOT NULL
    OR v_method ~ '(bank|fio|token|card|pos|external)'
    OR v_verification_source ~ '(bank|fio|token|external|cash_code)';

  SELECT COALESCE(array_agg(DISTINCT a.charge_id), ARRAY[]::bigint[])
    INTO v_charge_ids
  FROM public.miniapp_payment_allocations a
  WHERE a.payment_id = p_payment_id;

  IF v_payment.charge_id IS NOT NULL
     AND NOT (v_payment.charge_id = ANY(v_charge_ids)) THEN
    v_charge_ids := array_append(v_charge_ids, v_payment.charge_id);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT e.id ORDER BY e.id), ARRAY[]::bigint[])
    INTO v_finance_ids
  FROM public.bot_finance_events e
  WHERE e.payment_id = p_payment_id
     OR (e.source_type = 'client_payment' AND e.source_id = p_payment_id)
     OR (p_finance_event_id IS NOT NULL AND e.id = p_finance_event_id);

  IF v_external THEN
    -- Idempotent external reversal: never hard-delete a real bank/token/card record.
    IF COALESCE(v_payment.verification_status, 'verified') = 'reversed'
       OR v_payment.reversed_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'undo_mode', 'soft_reversal',
        'payment_id', p_payment_id,
        'already_reversed', true,
        'affected_charge_ids', v_charge_ids,
        'finance_event_ids', v_finance_ids,
        'amount', v_payment.amount
      );
    END IF;

    INSERT INTO public.payment_undo_audit_v25(
      payment_id, client_id, rental_id, amount, method, undo_mode,
      source, reason, deleted_by_telegram_id, finance_event_ids, affected_charge_ids
    ) VALUES (
      p_payment_id, v_payment.client_id, v_payment.rental_id, v_payment.amount,
      v_payment.method, 'soft_reversal', COALESCE(NULLIF(p_source,''),'admin'),
      v_reason, p_admin_tg_id, v_finance_ids, v_charge_ids
    );

    UPDATE public.client_payments
    SET verification_status = 'reversed',
        reversed_at = COALESCE(reversed_at, now()),
        reversal_reason = COALESCE(NULLIF(reversal_reason,''), v_reason),
        reversed_by_telegram_id = COALESCE(reversed_by_telegram_id, p_admin_tg_id),
        -- Remove the legacy direct charge link. The original charge is retained in
        -- payment_undo_audit_v25. This prevents any legacy distribution view from
        -- counting a reversed payment as paid after its allocations were removed.
        charge_id = NULL
    WHERE id = p_payment_id;

    DELETE FROM public.miniapp_payment_allocations
    WHERE payment_id = p_payment_id;
    GET DIAGNOSTICS v_allocations_removed = ROW_COUNT;

    FOREACH v_charge_id IN ARRAY v_charge_ids LOOP
      IF EXISTS (SELECT 1 FROM public.client_charges WHERE id = v_charge_id) THEN
        PERFORM public.miniapp_recalculate_charge_from_allocations_v221(
          v_charge_id,
          p_admin_tg_id,
          'external payment reversal #' || p_payment_id::text || ': ' || v_reason
        );
      END IF;
    END LOOP;

    UPDATE public.bot_finance_events e
    SET voided_at = COALESCE(e.voided_at, now()),
        voided_by_telegram_id = COALESCE(e.voided_by_telegram_id, p_admin_tg_id),
        void_reason = COALESCE(NULLIF(e.void_reason,''), v_reason),
        affects_cash = false,
        cash_amount = 0,
        action = 'void',
        event_type = 'payment_reversed',
        verification_status = 'reversed'
    WHERE e.id = ANY(v_finance_ids);
    GET DIAGNOSTICS v_finance_events_affected = ROW_COUNT;

    IF to_regclass('public.payment_verification_events') IS NOT NULL THEN
      INSERT INTO public.payment_verification_events(
        payment_id, payment_token_id, event_type, source,
        status_before, status_after, actor_telegram_id, details
      ) VALUES (
        p_payment_id,
        v_payment.payment_token_id,
        'reversed',
        COALESCE(NULLIF(p_source,''),'admin'),
        COALESCE(v_payment.verification_status,'verified'),
        'reversed',
        p_admin_tg_id,
        jsonb_build_object('reason', v_reason, 'affected_charge_ids', v_charge_ids)
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'undo_mode', 'soft_reversal',
      'payment_id', p_payment_id,
      'already_reversed', false,
      'amount', v_payment.amount,
      'client_id', v_payment.client_id,
      'rental_id', v_payment.rental_id,
      'affected_charge_ids', v_charge_ids,
      'finance_event_ids', v_finance_ids,
      'allocations_removed', v_allocations_removed,
      'finance_events_affected', v_finance_events_affected
    );
  END IF;

  -- Manual typo: keep only compact technical metadata, then remove the bad row
  -- from operational history entirely.
  INSERT INTO public.payment_undo_audit_v25(
    payment_id, client_id, rental_id, amount, method, undo_mode,
    source, reason, deleted_by_telegram_id, finance_event_ids, affected_charge_ids
  ) VALUES (
    p_payment_id, v_payment.client_id, v_payment.rental_id, v_payment.amount,
    v_payment.method, 'hard_delete', COALESCE(NULLIF(p_source,''),'admin'),
    v_reason, p_admin_tg_id, v_finance_ids, v_charge_ids
  );

  DELETE FROM public.miniapp_payment_allocations
  WHERE payment_id = p_payment_id;
  GET DIAGNOSTICS v_allocations_removed = ROW_COUNT;

  DELETE FROM public.bot_finance_events
  WHERE id = ANY(v_finance_ids);
  GET DIAGNOSTICS v_finance_events_affected = ROW_COUNT;

  -- Manual typo verification metadata is junk together with the payment itself.
  -- External/token payments never enter this branch.
  IF to_regclass('public.payment_verification_events') IS NOT NULL THEN
    DELETE FROM public.payment_verification_events
    WHERE payment_id = p_payment_id;
  END IF;

  DELETE FROM public.client_payments
  WHERE id = p_payment_id;

  FOREACH v_charge_id IN ARRAY v_charge_ids LOOP
    IF EXISTS (SELECT 1 FROM public.client_charges WHERE id = v_charge_id) THEN
      PERFORM public.miniapp_recalculate_charge_from_allocations_v221(
        v_charge_id,
        p_admin_tg_id,
        'manual payment hard undo #' || p_payment_id::text || ': ' || v_reason
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'undo_mode', 'hard_delete',
    'payment_id', p_payment_id,
    'deleted_payment_id', p_payment_id,
    'amount', v_payment.amount,
    'client_id', v_payment.client_id,
    'rental_id', v_payment.rental_id,
    'affected_charge_ids', v_charge_ids,
    'deleted_finance_event_ids', v_finance_ids,
    'allocations_removed', v_allocations_removed,
    'finance_events_affected', v_finance_events_affected
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.miniapp_undo_payment_v25(bigint,bigint,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.miniapp_undo_payment_v25(bigint,bigint,text,text,bigint) TO postgres, service_role;


-- -----------------------------------------------------------------------------
-- Reversed-payment allocation guard.
-- A legacy allocator must never attach a soft-reversed payment to a charge again.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_reversed_payment_allocation_v25()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $guard$
DECLARE
  v_status text;
  v_reversed_at timestamptz;
BEGIN
  SELECT COALESCE(verification_status, 'verified'), reversed_at
    INTO v_status, v_reversed_at
  FROM public.client_payments
  WHERE id = NEW.payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment #% not found for allocation', NEW.payment_id;
  END IF;

  IF v_status = 'reversed' OR v_reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment #% is reversed and cannot be allocated', NEW.payment_id;
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guard_reversed_payment_allocation_v25
  ON public.miniapp_payment_allocations;
CREATE TRIGGER trg_guard_reversed_payment_allocation_v25
BEFORE INSERT OR UPDATE ON public.miniapp_payment_allocations
FOR EACH ROW
EXECUTE FUNCTION public.guard_reversed_payment_allocation_v25();

-- Patch the currently installed advance allocator in-place when it is the known
-- legacy form that selects every client_payments row. This keeps the existing
-- function body/version while adding the two missing safety predicates.
DO $patch_allocator$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
BEGIN
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'miniapp_allocate_client_advance'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_oid IS NOT NULL THEN
    v_def := pg_get_functiondef(v_oid);
    IF position('p.verification_status' IN v_def) = 0 THEN
      v_new := regexp_replace(
        v_def,
        E'(WHERE\\s+p\\.client_id\\s*=\\s*p_client_id)',
        E'\\1\\n        AND COALESCE(p.verification_status, ''verified'') = ''verified''\\n        AND p.reversed_at IS NULL',
        'i'
      );
      IF v_new IS DISTINCT FROM v_def THEN
        EXECUTE v_new;
      ELSE
        RAISE WARNING 'v25: miniapp_allocate_client_advance found, but safety predicate anchor was not matched';
      END IF;
    END IF;
  END IF;
END;
$patch_allocator$;

-- -----------------------------------------------------------------------------
-- Balance view hardening.
-- Soft-reversed external payments intentionally remain in client_payments, so every
-- balance/advance consumer must count only verified payments. Charge values use the
-- v2.2.1 effective allocation truth where available.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.miniapp_client_balance_summary AS
WITH charge_totals AS (
  SELECT
    ch.client_id,
    COALESCE(SUM(ch.amount) FILTER (
      WHERE ex.charge_id IS NULL
        AND COALESCE(ch.status,'') NOT IN ('excluded','cancelled','canceled')
    ), 0)::numeric AS charged_total,
    COALESCE(SUM(COALESCE(t.effective_paid_amount, ch.paid_amount, 0)) FILTER (
      WHERE ex.charge_id IS NULL
        AND COALESCE(ch.status,'') NOT IN ('excluded','cancelled','canceled')
    ), 0)::numeric AS paid_on_charges,
    COALESCE(SUM(COALESCE(t.effective_debt_left, GREATEST(ch.amount - ch.paid_amount, 0))) FILTER (
      WHERE ex.charge_id IS NULL
        AND COALESCE(ch.status,'') NOT IN ('excluded','cancelled','canceled','paid')
    ), 0)::numeric AS open_debt_total,
    COALESCE(SUM(COALESCE(t.effective_debt_left, GREATEST(ch.amount - ch.paid_amount, 0))) FILTER (
      WHERE ex.charge_id IS NULL
        AND COALESCE(ch.status,'') NOT IN ('excluded','cancelled','canceled','paid')
        AND ch.due_date < CURRENT_DATE
    ), 0)::numeric AS overdue_total
  FROM public.client_charges ch
  LEFT JOIN public.miniapp_debt_exclusions ex ON ex.charge_id = ch.id
  LEFT JOIN public.miniapp_charge_allocation_truth_v221 t ON t.charge_id = ch.id
  GROUP BY ch.client_id
), payment_totals AS (
  SELECT
    p.client_id,
    COALESCE(SUM(p.amount), 0)::numeric AS payments_total
  FROM public.client_payments p
  WHERE COALESCE(p.verification_status, 'verified') = 'verified'
    AND p.reversed_at IS NULL
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
FROM public.clients c
LEFT JOIN charge_totals ct ON ct.client_id = c.id
LEFT JOIN payment_totals pt ON pt.client_id = c.id;

COMMIT;
