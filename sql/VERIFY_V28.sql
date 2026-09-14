-- v28 read-only verification

SELECT
  to_regprocedure('public.miniapp_attach_contract_battery_physical_v28(bigint,jsonb,bigint,text)') AS attach_rpc,
  to_regprocedure('public.miniapp_remove_contract_battery_physical_v28(bigint,bigint,bigint,text)') AS remove_rpc,
  to_regprocedure('public.miniapp_replace_contract_battery_physical_v28(bigint,bigint,jsonb,bigint,text)') AS replace_rpc,
  to_regprocedure('public.miniapp_repair_contract_battery_links_v28(bigint,bigint)') AS repair_rpc,
  to_regprocedure('public.miniapp_transfer_rental_bike_v28(bigint,bigint,boolean,bigint,text)') AS transfer_rpc,
  to_regclass('public.miniapp_battery_integrity_issues_v28') AS integrity_view;

SELECT *
FROM public.miniapp_battery_integrity_issues_v28
ORDER BY issue_type, rental_id NULLS LAST, battery_id;

-- Current active battery assignment overview:
SELECT
  r.id AS rental_id,
  r.bike_id,
  r.client_id,
  array_agg(br.battery_id ORDER BY br.battery_id)
    FILTER (WHERE br.status='active') AS active_battery_ids,
  count(*) FILTER (WHERE br.status='active') AS active_battery_count
FROM public.rentals r
LEFT JOIN public.battery_rentals br ON br.rental_id = r.id
WHERE r.status='active'
GROUP BY r.id, r.bike_id, r.client_id
ORDER BY r.id;
