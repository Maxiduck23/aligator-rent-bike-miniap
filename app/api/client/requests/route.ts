import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredString } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const TYPES: Record<string, string> = {
  rent_request: 'Новая аренда',
  battery_request: 'Батарея',
  repair_request: 'Ремонт',
  replace_request: 'Замена велосипеда',
  return_request: 'Возврат велосипеда',
  accessory_request: 'Аксессуар / зарядка',
  payment_request: 'Оплата / долг',
  contract_request: 'Договор / данные',
  other_request: 'Другое',
};

async function getClient(telegramId: number) {
  const { data, error } = await supabaseAdmin
    .from('miniapp_client_auth_map')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const client = await getClient(auth.telegramId);
    if (!client) throw new Error('Telegram не привязан к клиенту');
    const { data, error } = await supabaseAdmin
      .from('client_requests')
      .select('*')
      .eq('client_id', Number(client.client_id))
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const client = await getClient(auth.telegramId);
    if (!client) throw new Error('Telegram не привязан к клиенту');
    const clientId = Number(client.client_id);
    const body = await req.json();
    const requestType = requiredString(body.request_type, 'request_type');
    if (!TYPES[requestType]) throw new Error('Неизвестный тип запроса');
    const requestSubtype = optionalString(body.request_subtype);
    const preferredDate = optionalString(body.preferred_date);
    const bikeId = body.bike_id === null || body.bike_id === undefined || body.bike_id === '' ? null : Number(body.bike_id);
    let rentalId: number | null = null;

    if (bikeId !== null) {
      if (!Number.isFinite(bikeId) || bikeId <= 0) throw new Error('Некорректный велосипед');
      const { data: rental, error } = await supabaseAdmin
        .from('rentals')
        .select('id,bike_id,client_id,status')
        .eq('client_id', clientId)
        .eq('bike_id', bikeId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      if (!rental && !['rent_request','other_request'].includes(requestType)) {
        throw new Error('Этот велосипед не находится в твоей активной аренде');
      }
      rentalId = rental ? Number(rental.id) : null;
    }

    // No free-form client comment: description is generated from structured fields.
    const generatedDescription = [TYPES[requestType], requestSubtype ? `подтип: ${requestSubtype}` : '', bikeId ? `вел #${bikeId}` : '']
      .filter(Boolean).join(' · ');

    const { data, error } = await supabaseAdmin
      .from('client_requests')
      .insert({
        client_id: clientId,
        telegram_id: auth.telegramId,
        request_type: requestType,
        request_subtype: requestSubtype,
        status: 'new',
        priority: 'normal',
        title: TYPES[requestType],
        description: generatedDescription,
        preferred_date: preferredDate,
        bike_id: bikeId,
        rental_id: rentalId,
        metadata: { structured_v22: true },
      })
      .select('*')
      .single();
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
