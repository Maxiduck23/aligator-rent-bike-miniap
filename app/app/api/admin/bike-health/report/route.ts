import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const bikeId = requiredNumber(body.bike_id, 'bike_id');
    const km = requiredNumber(body.odometer_km, 'odometer_km');
    const allowLower = Boolean(body.allow_lower);
    const notes = optionalString(body.notes);

    const { data, error } = await supabaseAdmin.rpc('miniapp_record_odometer', {
      p_bike_id: bikeId,
      p_odometer_km: km,
      p_source: 'admin_miniapp',
      p_reported_by_telegram_id: auth.telegramId,
      p_notes: notes,
      p_allow_lower: allowLower,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
