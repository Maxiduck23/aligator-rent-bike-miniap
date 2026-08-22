import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function clientFor(req: NextRequest) {
  const auth = getAuthContext(req);
  const { data, error } = await supabaseAdmin
    .from('miniapp_client_auth_map')
    .select('client_id,client_name,telegram_id')
    .eq('telegram_id', auth.telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Telegram не привязан к клиенту');
  return { auth, clientId: Number(data.client_id), clientName: data.client_name || '' };
}

export async function GET(req: NextRequest) {
  try {
    const { clientId } = await clientFor(req);
    const { data, error } = await supabaseAdmin
      .from('payment_tokens')
      .select('id,token_last4,amount,status,created_at,expires_at,redeemed_at,payment_id,metadata')
      .eq('client_id', clientId)
      .eq('token_kind', 'cash')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { auth, clientId } = await clientFor(req);
    const body = await req.json();
    const mode = String(body.mode || 'charge');
    const amount = Number(body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма должна быть больше 0');

    const allocations: Array<{ charge_id: number; amount: number }> = [];

    if (mode === 'charge') {
      const chargeId = Number(body.charge_id);
      if (!Number.isFinite(chargeId) || chargeId <= 0) throw new Error('Не выбрано начисление');
      const { data: debt, error } = await supabaseAdmin
        .from('miniapp_debt_items')
        .select('charge_id,client_id,debt_left,is_excluded')
        .eq('charge_id', chargeId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      if (!debt || debt.is_excluded) throw new Error('Открытое начисление не найдено');
      const left = Number(debt.debt_left || 0);
      if (amount > left + 0.009) throw new Error(`По этому начислению осталось только ${Math.round(left)} Kč`);
      allocations.push({ charge_id: chargeId, amount });
    } else if (mode === 'multi') {
      const raw = Array.isArray(body.allocations) ? body.allocations : [];
      if (!raw.length) throw new Error('Не выбраны начисления');
      const ids = [...new Set(raw.map((x: any) => Number(x.charge_id)).filter((x: number) => Number.isFinite(x) && x > 0))];
      const { data: debts, error } = await supabaseAdmin
        .from('miniapp_debt_items')
        .select('charge_id,client_id,debt_left,is_excluded')
        .eq('client_id', clientId)
        .in('charge_id', ids);
      if (error) throw error;
      const byId = new Map((debts || []).map((d: any) => [Number(d.charge_id), d]));
      let sum = 0;
      for (const item of raw) {
        const chargeId = Number(item.charge_id);
        const part = Number(item.amount || 0);
        const debt = byId.get(chargeId);
        if (!debt || debt.is_excluded) throw new Error(`Начисление #${chargeId} не найдено`);
        if (!Number.isFinite(part) || part <= 0) throw new Error(`Некорректная сумма для #${chargeId}`);
        if (part > Number(debt.debt_left || 0) + 0.009) throw new Error(`Сумма для #${chargeId} больше остатка`);
        allocations.push({ charge_id: chargeId, amount: part });
        sum += part;
      }
      if (sum > amount + 0.009) throw new Error('Распределение больше суммы кода');
    } else if (mode !== 'advance') {
      throw new Error('Неизвестный режим cash-кода');
    }

    const { data, error } = await supabaseAdmin.rpc('miniapp_create_cash_token_v22', {
      p_client_id: clientId,
      p_amount: amount,
      p_allocations: allocations,
      p_created_by_telegram_id: auth.telegramId,
      p_ttl_hours: 24,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { clientId } = await clientFor(req);
    const body = await req.json();
    const tokenId = Number(body.token_id);
    if (!Number.isFinite(tokenId) || tokenId <= 0) throw new Error('token_id обязателен');
    const { data: current, error: currentError } = await supabaseAdmin
      .from('payment_tokens')
      .select('id,status,metadata')
      .eq('id', tokenId)
      .eq('client_id', clientId)
      .eq('token_kind', 'cash')
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current || current.status !== 'issued') throw new Error('Активный cash-код не найден');
    const { data, error } = await supabaseAdmin
      .from('payment_tokens')
      .update({ status: 'cancelled', metadata: { ...(current.metadata || {}), cancelled_by_client: true, cancelled_at: new Date().toISOString() } })
      .eq('id', tokenId)
      .eq('client_id', clientId)
      .eq('status', 'issued')
      .select('id,status')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Cash-код уже изменился');
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
