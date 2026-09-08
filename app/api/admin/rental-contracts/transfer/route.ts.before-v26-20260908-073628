import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const b = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_transfer_rental_bike', {
      p_rental_id: requiredNumber(b.rental_id, 'rental_id'),
      p_new_bike_id: requiredNumber(b.new_bike_id, 'new_bike_id'),
      p_keep_current_batteries: b.keep_current_batteries !== false,
      p_admin_tg_id: auth.telegramId,
      p_notes: optionalString(b.notes),
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
