import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function clientIdsForTelegram(telegramId: number): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from('miniapp_client_auth_map')
    .select('client_id')
    .eq('telegram_id', telegramId);
  if (error) throw error;
  return (data || []).map((x: any) => Number(x.client_id)).filter(Boolean);
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const clientIds = await clientIdsForTelegram(auth.telegramId);
    if (!clientIds.length) throw new Error('Telegram не привязан к клиенту.');

    const { data: bikes, error } = await supabaseAdmin
      .from('miniapp_client_health_bikes')
      .select('*')
      .in('client_id', clientIds)
      .order('bike_id');
    if (error) throw error;

    const bikeIds = (bikes || []).map((b: any) => b.bike_id);
    const [batteriesRes, serviceRes] = await Promise.all([
      bikeIds.length
        ? supabaseAdmin.from('miniapp_bike_battery_health').select('*').in('bike_id', bikeIds).order('battery_id')
        : Promise.resolve({ data: [], error: null } as any),
      bikeIds.length
        ? supabaseAdmin.from('bike_service_events').select('*').in('bike_id', bikeIds).order('performed_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (batteriesRes.error) throw batteriesRes.error;
    if (serviceRes.error) throw serviceRes.error;

    return ok({ bikes: bikes || [], batteries: batteriesRes.data || [], service_events: serviceRes.data || [] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const body = await req.json();
    const bikeId = requiredNumber(body.bike_id, 'bike_id');
    const km = requiredNumber(body.odometer_km, 'odometer_km');
    const notes = optionalString(body.notes);

    const clientIds = await clientIdsForTelegram(auth.telegramId);
    if (!clientIds.length) throw new Error('Telegram не привязан к клиенту.');

    const { data: rental, error: rentalError } = await supabaseAdmin
      .from('rentals')
      .select('id, client_id, bike_id, status')
      .eq('bike_id', bikeId)
      .eq('status', 'active')
      .in('client_id', clientIds)
      .maybeSingle();
    if (rentalError) throw rentalError;
    if (!rental) throw new Error('Этот велосипед не найден в твоей active аренде.');

    const { data, error } = await supabaseAdmin.rpc('miniapp_record_odometer', {
      p_bike_id: bikeId,
      p_odometer_km: km,
      p_source: 'client_miniapp',
      p_reported_by_telegram_id: auth.telegramId,
      p_notes: notes,
      p_allow_lower: false,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
