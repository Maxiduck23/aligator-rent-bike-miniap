import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredString } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function getClientByTelegram(telegramId: number) {
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
    const client = await getClientByTelegram(auth.telegramId);
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
    const client = await getClientByTelegram(auth.telegramId);
    if (!client) throw new Error('Telegram не привязан к клиенту');
    const body = await req.json();
    const requestType = requiredString(body.request_type, 'request_type');
    const description = requiredString(body.description, 'description');
    const preferredDate = optionalString(body.preferred_date);
    const titleMap: Record<string, string> = {
      rent_request: 'Запрос на аренду',
      battery_request: 'Запрос на доп. батарею',
      repair_request: 'Запрос на ремонт',
      payment_rule_request: 'Запрос изменить оплату',
      return_request: 'Запрос на возврат',
      accessory_request: 'Запрос аксессуара / зарядки',
      other_request: 'Другое',
    };
    const { data, error } = await supabaseAdmin
      .from('client_requests')
      .insert({
        client_id: Number(client.client_id),
        telegram_id: auth.telegramId,
        request_type: requestType,
        status: 'new',
        title: titleMap[requestType] || 'Клиентский запрос',
        description,
        preferred_date: preferredDate,
      })
      .select('*')
      .single();
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
