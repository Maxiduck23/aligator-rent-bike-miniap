import { NextRequest } from 'next/server';
import { fail, ok, optionalNumber, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();

    const { data, error } = await supabaseAdmin.rpc('miniapp_create_manual_charge', {
      p_client_id: requiredNumber(body.client_id, 'client_id'),
      p_rental_id: optionalNumber(body.rental_id),
      p_bike_id: optionalNumber(body.bike_id),
      p_charge_type: optionalString(body.charge_type) || 'manual',
      p_amount: requiredNumber(body.amount, 'amount'),
      p_due_date: optionalString(body.due_date),
      p_period_start: optionalString(body.period_start),
      p_period_end: optionalString(body.period_end),
      p_note: optionalString(body.note),
      p_admin_tg_id: auth.telegramId,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
