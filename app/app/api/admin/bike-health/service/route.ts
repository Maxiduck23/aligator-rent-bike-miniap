import { NextRequest } from 'next/server';
import { fail, ok, optionalNumber, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const bikeId = requiredNumber(body.bike_id, 'bike_id');
    const km = optionalNumber(body.odometer_km);
    const title = optionalString(body.title) || 'Простое ТО';
    const eventType = optionalString(body.event_type) || 'service';
    const cost = optionalNumber(body.cost) || 0;
    const description = optionalString(body.description);

    const { data, error } = await supabaseAdmin.rpc('miniapp_mark_bike_service_done', {
      p_bike_id: bikeId,
      p_odometer_km: km,
      p_title: title,
      p_event_type: eventType,
      p_cost: cost,
      p_description: description,
      p_admin_tg_id: auth.telegramId,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
