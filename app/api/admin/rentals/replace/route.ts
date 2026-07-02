import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_replace_rental_by_bike', {
      p_bike_id: requiredNumber(body.bike_id, 'bike_id'),
      p_new_client_id: requiredNumber(body.new_client_id, 'new_client_id'),
      p_price: requiredNumber(body.price, 'price'),
      p_start_date: body.start_date || new Date().toISOString().slice(0, 10),
      p_deposit: Number(body.deposit || 0),
      p_charger_quantity: Number(body.charger_quantity || 1),
      p_rental_type: optionalString(body.rental_type) || 'monthly',
      p_notes: optionalString(body.notes),
      p_deposit_refund: Number(body.deposit_refund || 0),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
