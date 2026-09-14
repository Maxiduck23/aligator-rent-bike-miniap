-- Aligator Rent CRM v28
-- Physical battery assignment / replacement after bike transfer.
--
-- IMPORTANT:
-- * Physical battery operations DO NOT change rent price, payment rules, charges or payments.
-- * Admin and worker use the same physical equipment RPCs.
-- * Old closed (rental_id,battery_id) rows are REACTIVATED instead of ON CONFLICT DO NOTHING.
-- * Bike transfer can recover legacy battery links from batteries.bike_id before moving them.
--
-- Apply in Supabase SQL Editor before deploying the Mini App code.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Attach one physical battery to an ACTIVE rental without financial changes.
--    p_battery:
--      {"mode":"existing","battery_id":123}
--      {"mode":"create","type_id":2,"note":"..."}
--      {"mode":"temporary","type_id":2,"note":"..."}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_attach_contract_battery_physical_v28(
  p_rental_id bigint,
  p_battery jsonb,
  p_admin_tg_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_mode text := lower(coalesce(p_battery->>'mode',''));
  v_battery_id bigint;
  v_type_id bigint;
  v_code text;
  v_temp boolean;
  v_other_rental bigint;
  v_existing_link public.battery_rentals%ROWTYPE;
  v_already_active boolean := false;
BEGIN
  SELECT *
    INTO v_rental
  FROM public.rentals
  WHERE id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Договор #% не найден.', p_rental_id;
  END IF;
  IF v_rental.status <> 'active' THEN
    RAISE EXCEPTION 'Батареи можно менять только в active договоре #%.' , p_rental_id;
  END IF;

  IF (
    SELECT count(*)
    FROM public.battery_rentals br
    WHERE br.rental_id = p_rental_id
      AND br.status = 'active'
  ) >= 10 THEN
    RAISE EXCEPTION 'В одном договоре нельзя держать больше 10 active батарей.';
  END IF;

  IF v_mode = 'existing' THEN
    v_battery_id := nullif(p_battery->>'battery_id','')::bigint;
    IF v_battery_id IS NULL OR v_battery_id <= 0 THEN
      RAISE EXCEPTION 'Для existing нужен battery_id.';
    END IF;

    -- Lock the battery itself.
    PERFORM 1
    FROM public.batteries b
    WHERE b.id = v_battery_id
      AND coalesce(b.asset_status,'active') = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Батарея #% не найдена или неактивна.', v_battery_id;
    END IF;

    SELECT br.rental_id
      INTO v_other_rental
    FROM public.battery_rentals br
    WHERE br.battery_id = v_battery_id
      AND br.status = 'active'
      AND br.rental_id <> p_rental_id
    ORDER BY br.id DESC
    LIMIT 1;

    IF v_other_rental IS NOT NULL THEN
      RAISE EXCEPTION 'Батарея #% уже находится в active договоре #%.' ,
        v_battery_id, v_other_rental;
    END IF;

    SELECT *
      INTO v_existing_link
    FROM public.battery_rentals
    WHERE rental_id = p_rental_id
      AND battery_id = v_battery_id
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE;

    v_already_active :=
      v_existing_link.id IS NOT NULL
      AND v_existing_link.status = 'active';

    UPDATE public.batteries
    SET bike_id = v_rental.bike_id,
        status = 'rented',
        first_used_at = coalesce(first_used_at, now())
    WHERE id = v_battery_id;

  ELSIF v_mode IN ('create','temporary') THEN
    v_type_id := nullif(p_battery->>'type_id','')::bigint;
    IF v_type_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.battery_types WHERE id = v_type_id
    ) THEN
      RAISE EXCEPTION 'Для новой/временной батареи нужен существующий type_id.';
    END IF;

    v_temp := v_mode = 'temporary';
    v_code := public.miniapp_next_battery_code(v_temp);

    INSERT INTO public.batteries(
      type_id,
      bike_id,
      status,
      notes,
      first_used_at,
      asset_status,
      inventory_code,
      indexing_status,
      temporary_label,
      created_from_rental_id,
      indexed_at,
      indexed_by_telegram_id,
      created_at
    )
    VALUES(
      v_type_id,
      v_rental.bike_id,
      'rented',
      nullif(btrim(coalesce(p_battery->>'note','')), ''),
      now(),
      'active',
      v_code,
      CASE WHEN v_temp THEN 'temporary' ELSE 'indexed' END,
      CASE WHEN v_temp THEN v_code ELSE NULL END,
      p_rental_id,
      CASE WHEN v_temp THEN NULL ELSE now() END,
      CASE WHEN v_temp THEN NULL ELSE p_admin_tg_id END,
      now()
    )
    RETURNING id INTO v_battery_id;
  ELSE
    RAISE EXCEPTION 'battery.mode должен быть existing, create или temporary.';
  END IF;

  -- Critical v28 fix:
  -- the pair (rental_id,battery_id) is unique. If it existed as closed/replaced,
  -- re-activate that SAME row instead of silently doing nothing.
  INSERT INTO public.battery_rentals(
    rental_id, battery_id, status, created_at, returned_at, notes
  )
  VALUES(
    p_rental_id,
    v_battery_id,
    'active',
    now(),
    NULL,
    trim(both E'\n' from concat_ws(
      E'\n',
      p_notes,
      'v28 physical attach'
    ))
  )
  ON CONFLICT (rental_id, battery_id)
  DO UPDATE SET
    status = 'active',
    returned_at = NULL,
    notes = trim(both E'\n' from concat_ws(
      E'\n',
      public.battery_rentals.notes,
      EXCLUDED.notes,
      'reactivated at ' || now()::text
    ));

  IF NOT v_already_active THEN
    INSERT INTO public.rental_equipment_events(
      rental_id, equipment_type, equipment_id, action,
      quantity, fee_amount, effective_date, notes, created_by_telegram_id
    )
    VALUES(
      p_rental_id, 'battery', v_battery_id, 'issued',
      1, 0, CURRENT_DATE,
      trim(both E'\n' from concat_ws(E'\n', p_notes, 'v28 physical attach; NO financial change')),
      p_admin_tg_id
    );
  END IF;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_attach_contract_battery_physical_v28',
    jsonb_build_object(
      'rental_id', p_rental_id,
      'bike_id', v_rental.bike_id,
      'battery_id', v_battery_id,
      'mode', v_mode,
      'already_active', v_already_active,
      'financial_change', false
    )
  );

  RETURN jsonb_build_object(
    'rental_id', p_rental_id,
    'bike_id', v_rental.bike_id,
    'battery_id', v_battery_id,
    'mode', v_mode,
    'already_active', v_already_active,
    'financial_change', false
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 2) Remove one physical battery from an active rental without financial changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_remove_contract_battery_physical_v28(
  p_rental_id bigint,
  p_battery_id bigint,
  p_admin_tg_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_link public.battery_rentals%ROWTYPE;
BEGIN
  SELECT *
    INTO v_rental
  FROM public.rentals
  WHERE id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Договор #% не найден.', p_rental_id;
  END IF;
  IF v_rental.status <> 'active' THEN
    RAISE EXCEPTION 'Батареи можно менять только в active договоре #%.' , p_rental_id;
  END IF;

  SELECT *
    INTO v_link
  FROM public.battery_rentals
  WHERE rental_id = p_rental_id
    AND battery_id = p_battery_id
    AND status = 'active'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Батарея #% не active в договоре #%.' , p_battery_id, p_rental_id;
  END IF;

  UPDATE public.battery_rentals
  SET status = 'closed',
      returned_at = now(),
      notes = trim(both E'\n' from concat_ws(
        E'\n',
        notes,
        p_notes,
        'v28 physical remove; NO financial change'
      ))
  WHERE id = v_link.id;

  UPDATE public.batteries
  SET status = 'free',
      bike_id = NULL
  WHERE id = p_battery_id;

  INSERT INTO public.rental_equipment_events(
    rental_id, equipment_type, equipment_id, action,
    quantity, fee_amount, effective_date, notes, created_by_telegram_id
  )
  VALUES(
    p_rental_id, 'battery', p_battery_id, 'returned',
    1, 0, CURRENT_DATE,
    trim(both E'\n' from concat_ws(E'\n', p_notes, 'v28 physical remove; NO financial change')),
    p_admin_tg_id
  );

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_remove_contract_battery_physical_v28',
    jsonb_build_object(
      'rental_id', p_rental_id,
      'battery_id', p_battery_id,
      'financial_change', false
    )
  );

  RETURN jsonb_build_object(
    'rental_id', p_rental_id,
    'battery_id', p_battery_id,
    'removed', true,
    'financial_change', false
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 3) Atomic physical replacement: attach the new battery, then retire the old one.
--    If anything fails, PostgreSQL rolls the whole RPC back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_replace_contract_battery_physical_v28(
  p_rental_id bigint,
  p_old_battery_id bigint,
  p_new_battery jsonb,
  p_admin_tg_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_old_link public.battery_rentals%ROWTYPE;
  v_new_result jsonb;
  v_new_battery_id bigint;
BEGIN
  SELECT *
    INTO v_rental
  FROM public.rentals
  WHERE id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND OR v_rental.status <> 'active' THEN
    RAISE EXCEPTION 'Active договор #% не найден.', p_rental_id;
  END IF;

  SELECT *
    INTO v_old_link
  FROM public.battery_rentals
  WHERE rental_id = p_rental_id
    AND battery_id = p_old_battery_id
    AND status = 'active'
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Старая батарея #% не active в договоре #%.' ,
      p_old_battery_id, p_rental_id;
  END IF;

  IF lower(coalesce(p_new_battery->>'mode','')) = 'existing'
     AND nullif(p_new_battery->>'battery_id','')::bigint = p_old_battery_id THEN
    RAISE EXCEPTION 'Новая батарея совпадает со старой #%.' , p_old_battery_id;
  END IF;

  v_new_result := public.miniapp_attach_contract_battery_physical_v28(
    p_rental_id,
    p_new_battery,
    p_admin_tg_id,
    trim(both E'\n' from concat_ws(E'\n', p_notes, 'replacement new battery'))
  );
  v_new_battery_id := (v_new_result->>'battery_id')::bigint;

  UPDATE public.battery_rentals
  SET status = 'replaced',
      returned_at = now(),
      notes = trim(both E'\n' from concat_ws(
        E'\n',
        notes,
        p_notes,
        'replaced by battery #' || v_new_battery_id::text || ' at ' || now()::text
      ))
  WHERE id = v_old_link.id;

  UPDATE public.batteries
  SET status = 'free',
      bike_id = NULL
  WHERE id = p_old_battery_id;

  INSERT INTO public.rental_equipment_events(
    rental_id, equipment_type, equipment_id, action,
    quantity, fee_amount, effective_date, notes, created_by_telegram_id
  )
  VALUES(
    p_rental_id, 'battery', p_old_battery_id, 'replaced',
    1, 0, CURRENT_DATE,
    'replaced by battery #' || v_new_battery_id::text ||
      '; v28 physical replacement; NO financial change',
    p_admin_tg_id
  );

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_replace_contract_battery_physical_v28',
    jsonb_build_object(
      'rental_id', p_rental_id,
      'old_battery_id', p_old_battery_id,
      'new_battery_id', v_new_battery_id,
      'financial_change', false
    )
  );

  RETURN jsonb_build_object(
    'rental_id', p_rental_id,
    'old_battery_id', p_old_battery_id,
    'new_battery_id', v_new_battery_id,
    'financial_change', false
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 4) Repair legacy links for an active rental.
--    This is deliberately conservative: only batteries that already point to the
--    rental's CURRENT bike and are status='rented', and are not active elsewhere.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_repair_contract_battery_links_v28(
  p_rental_id bigint,
  p_admin_tg_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_bat record;
  v_count int := 0;
  v_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  SELECT *
    INTO v_rental
  FROM public.rentals
  WHERE id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND OR v_rental.status <> 'active' THEN
    RAISE EXCEPTION 'Active договор #% не найден.', p_rental_id;
  END IF;

  FOR v_bat IN
    SELECT b.id
    FROM public.batteries b
    WHERE b.bike_id = v_rental.bike_id
      AND b.status = 'rented'
      AND coalesce(b.asset_status,'active') = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.battery_rentals br_other
        WHERE br_other.battery_id = b.id
          AND br_other.status = 'active'
          AND br_other.rental_id <> p_rental_id
      )
    ORDER BY b.id
  LOOP
    INSERT INTO public.battery_rentals(
      rental_id, battery_id, status, created_at, returned_at, notes
    )
    VALUES(
      p_rental_id, v_bat.id, 'active', now(), NULL,
      'v28 recovered from batteries.bike_id/status'
    )
    ON CONFLICT (rental_id, battery_id)
    DO UPDATE SET
      status = 'active',
      returned_at = NULL,
      notes = trim(both E'\n' from concat_ws(
        E'\n',
        public.battery_rentals.notes,
        'v28 recovered at ' || now()::text
      ));

    v_count := v_count + 1;
    v_ids := array_append(v_ids, v_bat.id);
  END LOOP;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_repair_contract_battery_links_v28',
    jsonb_build_object(
      'rental_id', p_rental_id,
      'bike_id', v_rental.bike_id,
      'recovered_count', v_count,
      'battery_ids', v_ids
    )
  );

  RETURN jsonb_build_object(
    'rental_id', p_rental_id,
    'bike_id', v_rental.bike_id,
    'recovered_count', v_count,
    'battery_ids', v_ids
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 5) Safe bike transfer v28.
--    keep=true:
--      first recovers legacy links on the OLD bike, then moves active batteries.
--    keep=false:
--      closes/release physical batteries, no price/payment changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_transfer_rental_bike_v28(
  p_rental_id bigint,
  p_new_bike_id bigint,
  p_keep_current_batteries boolean DEFAULT true,
  p_admin_tg_id bigint DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rental public.rentals%ROWTYPE;
  v_old_bike_id bigint;
  v_battery_ids bigint[] := ARRAY[]::bigint[];
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT *
    INTO v_rental
  FROM public.rentals
  WHERE id = p_rental_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Договор #% не найден.', p_rental_id;
  END IF;
  IF v_rental.status <> 'active' THEN
    RAISE EXCEPTION 'Пересадка доступна только для active договора.';
  END IF;

  v_old_bike_id := v_rental.bike_id;
  IF p_new_bike_id = v_old_bike_id THEN
    RAISE EXCEPTION 'Новый велик совпадает с текущим.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bikes
    WHERE id = p_new_bike_id
      AND coalesce(asset_status,'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'Новый велик #% не найден/неактивен.', p_new_bike_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rentals
    WHERE bike_id = p_new_bike_id
      AND status = 'active'
      AND id <> p_rental_id
  ) THEN
    RAISE EXCEPTION 'У велика #% уже есть active аренда.', p_new_bike_id;
  END IF;

  v_before := to_jsonb(v_rental);

  IF coalesce(p_keep_current_batteries, true) THEN
    -- Recover old legacy state BEFORE the rental changes bike_id.
    PERFORM public.miniapp_repair_contract_battery_links_v28(
      p_rental_id,
      p_admin_tg_id
    );

    SELECT coalesce(array_agg(br.battery_id ORDER BY br.battery_id), ARRAY[]::bigint[])
      INTO v_battery_ids
    FROM public.battery_rentals br
    WHERE br.rental_id = p_rental_id
      AND br.status = 'active';

    UPDATE public.batteries
    SET bike_id = p_new_bike_id,
        status = 'rented'
    WHERE id = ANY(v_battery_ids);
  ELSE
    SELECT coalesce(array_agg(br.battery_id ORDER BY br.battery_id), ARRAY[]::bigint[])
      INTO v_battery_ids
    FROM public.battery_rentals br
    WHERE br.rental_id = p_rental_id
      AND br.status = 'active';

    UPDATE public.battery_rentals
    SET status = 'closed',
        returned_at = now(),
        notes = trim(both E'\n' from concat_ws(
          E'\n',
          notes,
          p_notes,
          'closed by bike transfer v28'
        ))
    WHERE rental_id = p_rental_id
      AND status = 'active';

    UPDATE public.batteries
    SET status = 'free',
        bike_id = NULL
    WHERE id = ANY(v_battery_ids);
  END IF;

  UPDATE public.bikes
  SET status = 'free',
      updated_at = now()
  WHERE id = v_old_bike_id;

  UPDATE public.bikes
  SET status = 'rented',
      updated_at = now()
  WHERE id = p_new_bike_id;

  UPDATE public.rentals
  SET bike_id = p_new_bike_id
  WHERE id = p_rental_id;

  -- Only current open obligations follow the current bike.
  -- Historical PAID rows stay where they were.
  UPDATE public.client_charges
  SET bike_id = p_new_bike_id,
      updated_at = now()
  WHERE rental_id = p_rental_id
    AND status IN ('due','partial');

  SELECT to_jsonb(r.*)
    INTO v_after
  FROM public.rentals r
  WHERE id = p_rental_id;

  IF to_regclass('public.rental_contract_events') IS NOT NULL THEN
    INSERT INTO public.rental_contract_events(
      rental_id, event_type, actor_telegram_id,
      before_data, after_data, notes
    )
    VALUES(
      p_rental_id,
      'bike_transferred',
      p_admin_tg_id,
      v_before,
      v_after,
      trim(both E'\n' from concat_ws(
        E'\n',
        p_notes,
        'v28; keep_batteries=' || coalesce(p_keep_current_batteries,true)::text
      ))
    );
  END IF;

  PERFORM public.miniapp_audit(
    p_admin_tg_id,
    'miniapp_transfer_rental_bike_v28',
    jsonb_build_object(
      'rental_id', p_rental_id,
      'old_bike_id', v_old_bike_id,
      'new_bike_id', p_new_bike_id,
      'keep_current_batteries', coalesce(p_keep_current_batteries,true),
      'battery_ids', v_battery_ids,
      'payment_created', false,
      'charge_created', false
    )
  );

  RETURN jsonb_build_object(
    'rental', v_after,
    'old_bike_id', v_old_bike_id,
    'new_bike_id', p_new_bike_id,
    'battery_ids', v_battery_ids,
    'keep_current_batteries', coalesce(p_keep_current_batteries,true),
    'payment_created', false,
    'charge_created', false
  );
END;
$function$;


-- ---------------------------------------------------------------------------
-- 6) Read-only diagnostics used during DB normalization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.miniapp_battery_integrity_issues_v28 AS

SELECT
  'rented_battery_without_active_link'::text AS issue_type,
  b.id::bigint AS battery_id,
  b.bike_id::bigint AS bike_id,
  NULL::bigint AS rental_id,
  'batteries.status=rented, но active battery_rentals отсутствует'::text AS description
FROM public.batteries b
WHERE b.status = 'rented'
  AND coalesce(b.asset_status,'active') = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.battery_rentals br
    WHERE br.battery_id = b.id
      AND br.status = 'active'
  )

UNION ALL

SELECT
  'active_link_on_inactive_rental',
  br.battery_id::bigint,
  r.bike_id::bigint,
  br.rental_id::bigint,
  'battery_rentals active, но rental не active'
FROM public.battery_rentals br
JOIN public.rentals r ON r.id = br.rental_id
WHERE br.status = 'active'
  AND r.status <> 'active'

UNION ALL

SELECT
  'active_link_battery_not_rented',
  br.battery_id::bigint,
  r.bike_id::bigint,
  br.rental_id::bigint,
  'battery_rentals active, но batteries.status != rented'
FROM public.battery_rentals br
JOIN public.rentals r ON r.id = br.rental_id
JOIN public.batteries b ON b.id = br.battery_id
WHERE br.status = 'active'
  AND b.status <> 'rented'

UNION ALL

SELECT
  'active_link_wrong_bike',
  br.battery_id::bigint,
  b.bike_id::bigint,
  br.rental_id::bigint,
  'battery.bike_id не совпадает с текущим rental.bike_id'
FROM public.battery_rentals br
JOIN public.rentals r ON r.id = br.rental_id
JOIN public.batteries b ON b.id = br.battery_id
WHERE br.status = 'active'
  AND b.bike_id IS DISTINCT FROM r.bike_id

UNION ALL

SELECT
  'battery_active_in_multiple_rentals',
  br.battery_id::bigint,
  NULL::bigint,
  MIN(br.rental_id)::bigint,
  'Одна батарея active сразу в нескольких договорах: ' || count(*)::text
FROM public.battery_rentals br
WHERE br.status = 'active'
GROUP BY br.battery_id
HAVING count(*) > 1;


REVOKE EXECUTE ON FUNCTION public.miniapp_attach_contract_battery_physical_v28(bigint,jsonb,bigint,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_remove_contract_battery_physical_v28(bigint,bigint,bigint,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_replace_contract_battery_physical_v28(bigint,bigint,jsonb,bigint,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_repair_contract_battery_links_v28(bigint,bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.miniapp_transfer_rental_bike_v28(bigint,bigint,boolean,bigint,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.miniapp_attach_contract_battery_physical_v28(bigint,jsonb,bigint,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_remove_contract_battery_physical_v28(bigint,bigint,bigint,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_replace_contract_battery_physical_v28(bigint,bigint,jsonb,bigint,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_repair_contract_battery_links_v28(bigint,bigint) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_transfer_rental_bike_v28(bigint,bigint,boolean,bigint,text) TO postgres, service_role;

COMMIT;
