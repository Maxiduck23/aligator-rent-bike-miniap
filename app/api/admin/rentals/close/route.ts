import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_close_rental_by_bike', {
      p_bike_id: requiredNumber(body.bike_id, 'bike_id'),
      p_end_date: body.end_date || new Date().toISOString().slice(0, 10),
      p_bike_status: optionalString(body.bike_status) || 'free',
      p_notes: optionalString(body.notes),
      p_deposit_refund: Number(body.deposit_refund || 0),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
