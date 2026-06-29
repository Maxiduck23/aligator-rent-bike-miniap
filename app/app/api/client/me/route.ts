import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
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
    if (!client) throw new Error('Telegram не привязан к клиенту. Открой ссылку-ключ от админа или попроси привязать Telegram ID.');

    const clientId = Number(client.client_id);

    const [rentalsRes, debtsRes, balancesRes, rulesRes, requestsRes, paymentsRes] = await Promise.all([
      supabaseAdmin.from('miniapp_active_rentals').select('*').eq('client_id', clientId).order('id', { ascending: false }),
      supabaseAdmin.from('miniapp_debt_items').select('*').eq('client_id', clientId).order('due_date'),
      supabaseAdmin.from('miniapp_client_category_balances').select('*').eq('client_id', clientId).order('category'),
      supabaseAdmin.from('miniapp_payment_rules').select('*').eq('client_id', clientId).eq('is_active', true).order('id', { ascending: false }),
      supabaseAdmin.from('miniapp_payment_rule_change_requests').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
      supabaseAdmin.from('client_payments').select('*').eq('client_id', clientId).order('payment_date', { ascending: false }).limit(20),
    ]);

    for (const r of [rentalsRes, debtsRes, balancesRes, rulesRes, requestsRes, paymentsRes]) {
      if (r.error) throw r.error;
    }

    return ok({
      auth: { telegram_id: auth.telegramId, is_admin: auth.isAdmin },
      client,
      active_rentals: rentalsRes.data || [],
      debts: debtsRes.data || [],
      balances: balancesRes.data || [],
      payment_rules: rulesRes.data || [],
      requests: requestsRes.data || [],
      payments: paymentsRes.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
