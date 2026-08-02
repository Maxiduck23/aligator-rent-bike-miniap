import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateRentalContractInput } from '@/lib/rentalContracts';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { data, error } = await supabaseAdmin
      .from('rental_plans')
      .select('*, rental_plan_steps(*)')
      .eq('is_active', true)
      .order('first_period_rent', { ascending: true });

    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const input = validateRentalContractInput(body);

    const { data, error } = await supabaseAdmin.rpc('miniapp_create_rental_contract', {
      p_bike_id: requiredNumber(input.bike_id, 'bike_id'),
      p_client_id: requiredNumber(input.client_id, 'client_id'),
      p_plan_code: input.plan_code,
      p_start_date: input.start_date,
      p_batteries: input.batteries,
      p_charger_quantity: input.charger_quantity,
      p_extra_battery_count: input.extra_battery_count,
      p_initial_payment: input.initial_payment.amount,
      p_payment_method: input.initial_payment.method,
      p_notes: optionalString(input.notes),
      p_admin_tg_id: auth.telegramId,
    });

    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
