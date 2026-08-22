-- Read-only checks after Operations v2.2

select count(*) as batteries_total,
       count(*) filter (where overview_status='assigned') as assigned,
       count(*) filter (where overview_status in ('free','legacy_link')) as free_or_legacy,
       count(*) filter (where cardinality(warnings)>0) as with_warnings
from public.miniapp_battery_overview_v22;

select status, request_type, priority, count(*)
from public.client_requests
group by status, request_type, priority
order by status, request_type, priority;

select id, token_last4, client_id, amount, token_kind, status, created_at, expires_at
from public.payment_tokens
where token_kind='cash'
order by id desc
limit 20;

select payment_token_id, charge_id, planned_amount, priority
from public.payment_token_allocations
order by id desc
limit 30;

select id, client_id, rental_id, charge_id, amount, method, verification_source, verification_status, payment_token_id
from public.client_payments
where verification_source='cash_code'
order by id desc
limit 20;
