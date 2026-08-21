import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateRentalContractInput } from '@/lib/rentalContracts';

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
    const { data, error } = await supabaseAdmin
      .from('rental_plan_model_prices')
      .select('*')
      .eq('bike_model', bike.model)
      .eq('plan_code', planCode)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    override = data;
  }
  return { bike, plan, override };
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const bikeId = Number(url.searchParams.get('bike_id') || 0);
    const { data: plans, error } = await supabaseAdmin
      .from('rental_plans')
      .select('*, rental_plan_steps(*)')
      .eq('is_active', true)
      .order('first_period_rent', { ascending: true });
    if (error) throw error;

    if (!bikeId) return ok(plans || []);
    const { data: bike, error: bikeError } = await supabaseAdmin.from('bikes').select('id,model').eq('id', bikeId).maybeSingle();
    if (bikeError) throw bikeError;
    if (!bike?.model) return ok(plans || []);
    const { data: overrides, error: overrideError } = await supabaseAdmin
      .from('rental_plan_model_prices')
      .select('*')
      .eq('bike_model', bike.model)
      .eq('is_active', true);
    if (overrideError) throw overrideError;
    const byCode = new Map((overrides || []).map((x: any) => [x.plan_code, x]));
    return ok((plans || []).map((p: any) => ({ ...p, model_price_override: byCode.get(p.code) || null })));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const input = validateRentalContractInput(await req.json());
    const cfg = await modelOverrideForBike(input.bike_id, input.plan_code);

    // Model price is the default. Explicit fields from the form override the model default.
    // recurring_rent in rentals represents the TOTAL recurring amount, therefore extra
    // battery fees are added to the base rent here.
    const extraFee = Number(cfg.override?.extra_battery_monthly_fee ?? cfg.plan.extra_battery_monthly_fee ?? 0);
    const baseRecurring = Number(input.recurring_rent_override ?? cfg.override?.recurring_rent ?? cfg.plan.recurring_rent ?? 0);
    const recurringTotal = baseRecurring + Number(input.extra_battery_count || 0) * extraFee;
    const deposit = Number(input.deposit_override ?? cfg.override?.deposit_amount ?? cfg.plan.deposit_amount ?? 0);
    const firstPeriod = Number(input.first_period_rent_override ?? cfg.override?.first_period_rent ?? cfg.plan.first_period_rent ?? 0);

    const { data, error } = await supabaseAdmin.rpc('miniapp_create_rental_contract_v2', {
      p_bike_id: requiredNumber(input.bike_id, 'bike_id'),
      p_client_id: requiredNumber(input.client_id, 'client_id'),
      p_plan_code: input.plan_code,
      p_start_date: input.start_date,
      p_batteries: input.batteries,
      p_charger_quantity: input.charger_quantity,
      p_extra_battery_count: input.extra_battery_count,
      p_notes: optionalString(input.notes),
      p_admin_tg_id: auth.telegramId,
      p_recurring_rent_override: recurringTotal,
      p_deposit_override: deposit,
      p_first_period_rent_override: firstPeriod,
      p_extra_battery_fee_override: extraFee,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
