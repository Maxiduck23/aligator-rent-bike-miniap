-- v27 verification. Read-only.
SELECT
  to_regprocedure('public.miniapp_asset_bike_purchase_v27(bigint,text,text,text,numeric,date,text,bigint,text)') AS bike_purchase_rpc,
  to_regprocedure('public.miniapp_asset_bike_sale_v27(bigint,numeric,date,text,bigint,text)') AS bike_sale_rpc,
  to_regprocedure('public.miniapp_asset_battery_purchase_v27(bigint,bigint,bigint,numeric,date,text,bigint,text)') AS battery_purchase_rpc,
  to_regprocedure('public.miniapp_asset_battery_sale_v27(bigint,numeric,date,text,bigint,text)') AS battery_sale_rpc,
  to_regclass('public.miniapp_asset_integrity_issues_v27') AS integrity_view,
  to_regclass('public.asset_operation_requests_v27') AS idempotency_table;

SELECT *
FROM public.miniapp_asset_integrity_issues_v27
ORDER BY issue_type, asset_type, asset_id;

SELECT
  (SELECT COALESCE(MAX(id),0)+1 FROM public.bikes) AS next_bike_id,
  (SELECT COALESCE(MAX(id),0)+1 FROM public.batteries) AS next_battery_id;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid='public.asset_transactions'::regclass
  AND tgname='trg_guard_asset_transaction_once_v27';
