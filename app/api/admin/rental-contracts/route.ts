import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireStaff } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateBatterySlot, validateRentalContractInput } from '@/lib/rentalContracts';

function moneyNumber(v: unknown, field: string, allowZero = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new Error(`${field} должен быть ${allowZero ? '0 или больше' : 'больше 0'}`);
  return n;
}
async function modelOverrideForBike(bikeId: number, planCode: string) {
  const [{ data: bike, error: bikeError }, { data: plan, error: planError }] = await Promise.all([
    supabaseAdmin.from('bikes').select('id,model').eq('id', bikeId).maybeSingle(),
    supabaseAdmin.from('rental_plans').select('*').eq('code', planCode).eq('is_active', true).maybeSingle(),
  ]);
  if (bikeError) throw bikeError;
  if (planError) throw planError;
  if (!plan) throw new Error(`Тариф ${planCode} не найден`);
  let override: any = null;
  if (bike?.model) {
    const r = await supabaseAdmin.from('rental_plan_model_prices').select('*').eq('bike_model', bike.model).eq('plan_code', planCode).eq('is_active', true).maybeSingle();
    if (r.error) throw r.error;
    override = r.data;
  }
  return { bike, plan, override };
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    if (auth.isWorker) return ok([]); // internal tariff prices are not exposed to worker
    const url = new URL(req.url);
    const bikeId = Number(url.searchParams.get('bike_id') || 0);
    const { data: plans, error } = await supabaseAdmin.from('rental_plans').select('*, rental_plan_steps(*)').eq('is_active', true).order('first_period_rent', { ascending: true });
    if (error) throw error;
    if (!bikeId) return ok(plans || []);
    const { data: bike, error: bikeError } = await supabaseAdmin.from('bikes').select('id,model').eq('id', bikeId).maybeSingle();
    if (bikeError) throw bikeError;
    if (!bike?.model) return ok(plans || []);
    const { data: overrides, error: overrideError } = await supabaseAdmin.from('rental_plan_model_prices').select('*').eq('bike_model', bike.model).eq('is_active', true);
    if (overrideError) throw overrideError;
    const byCode = new Map((overrides || []).map((x: any) => [x.plan_code, x]));
    return ok((plans || []).map((p: any) => ({ ...p, model_price_override: byCode.get(p.code) || null })));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();

    // v26 main flow: user enters exact monthly amount. A simple 1/2-battery plan is
    // only an internal DB template so existing tested RPCs/triggers stay intact.
    if (String(body.contract_mode || '') === 'manual_v26') {
      if (!Array.isArray(body.batteries) || body.batteries.length < 1 || body.batteries.length > 10) throw new Error('Укажи от 1 до 10 батарей');
      const batteries = body.batteries.map(validateBatterySlot);
      const monthlyRent = moneyNumber(body.monthly_rent, 'monthly_rent');
      const deposit = moneyNumber(body.deposit ?? 0, 'deposit', true);
      const chargers = Number(body.charger_quantity ?? 1);
      if (!Number.isInteger(chargers) || chargers < 0 || chargers > 10) throw new Error('charger_quantity должен быть 0..10');

      const oneBattery = batteries.length === 1;
      const planCode = oneBattery ? 'monthly_1_battery' : 'monthly_2_batteries';
      const extraBatteryCount = oneBattery ? 0 : Math.max(0, batteries.length - 2);

      const { data, error } = await supabaseAdmin.rpc('miniapp_create_rental_contract_v2', {
        p_bike_id: requiredNumber(body.bike_id, 'bike_id'),
        p_client_id: requiredNumber(body.client_id, 'client_id'),
        p_plan_code: planCode,
        p_start_date: body.start_date || new Date().toISOString().slice(0, 10),
        p_batteries: batteries,
        p_charger_quantity: chargers,
        p_extra_battery_count: extraBatteryCount,
        p_notes: optionalString(body.notes),
        p_admin_tg_id: auth.telegramId,
        // Exact values override the internal template completely.
        p_recurring_rent_override: monthlyRent,
        p_deposit_override: deposit,
        p_first_period_rent_override: monthlyRent,
        p_extra_battery_fee_override: 0,
      });
      if (error) throw error;
      return ok(data, 201);
    }

    // Old plan flow remains for backwards compatibility, admin only.
    if (auth.isWorker) throw new Error('Worker can create only manual_v26 contracts');
    const input = validateRentalContractInput(body);
    const cfg = await modelOverrideForBike(input.bike_id, input.plan_code);
    const extraFee = Number(cfg.override?.extra_battery_monthly_fee ?? cfg.plan.extra_battery_monthly_fee ?? 0);
    const baseRecurring = Number(input.recurring_rent_override ?? cfg.override?.recurring_rent ?? cfg.plan.recurring_rent ?? 0);
    const recurringTotal = baseRecurring + Number(input.extra_battery_count || 0) * extraFee;
    const deposit = Number(input.deposit_override ?? cfg.override?.deposit_amount ?? cfg.plan.deposit_amount ?? 0);
    const firstPeriod = Number(input.first_period_rent_override ?? cfg.override?.first_period_rent ?? cfg.plan.first_period_rent ?? 0);
    const { data, error } = await supabaseAdmin.rpc('miniapp_create_rental_contract_v2', {
      p_bike_id: input.bike_id, p_client_id: input.client_id, p_plan_code: input.plan_code, p_start_date: input.start_date,
      p_batteries: input.batteries, p_charger_quantity: input.charger_quantity, p_extra_battery_count: input.extra_battery_count,
      p_notes: optionalString(input.notes), p_admin_tg_id: auth.telegramId,
      p_recurring_rent_override: recurringTotal, p_deposit_override: deposit,
      p_first_period_rent_override: firstPeriod, p_extra_battery_fee_override: extraFee,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) { return fail(e); }
}
