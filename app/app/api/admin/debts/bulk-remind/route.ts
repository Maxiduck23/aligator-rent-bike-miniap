import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function sendTelegramMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${body}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const chargeIds = Array.isArray(body.charge_ids) ? body.charge_ids.map(Number).filter(Number.isFinite) : [];
    if (!chargeIds.length) throw new Error('charge_ids is required');

    const { data: charges, error } = await supabaseAdmin
      .from('miniapp_debt_items')
      .select('*')
      .in('charge_id', chargeIds)
      .eq('is_excluded', false);
    if (error) throw error;

    const grouped = new Map<number, any[]>();
    for (const ch of charges || []) {
      const tg = Number(ch.private_telegram_id || ch.client_telegram_id || 0);
      if (!tg) continue;
      if (!grouped.has(tg)) grouped.set(tg, []);
      grouped.get(tg)!.push(ch);
    }

    const sent: number[] = [];
    const skipped: number[] = [];
    for (const [telegramId, rows] of grouped.entries()) {
      const total = rows.reduce((sum, r) => sum + Number(r.debt_left || 0), 0);
      const lines = rows.map((r) => `• #${r.charge_id} ${r.bike_label || ''} — ${Number(r.debt_left).toFixed(0)} Kč, до ${r.due_date}`).join('\n');
      const text = `💳 Напоминание об оплате\n\nОткрыто к оплате: <b>${total.toFixed(0)} Kč</b>\n\n${lines}\n\nЕсли уже оплатил — напиши админу.`;
      await sendTelegramMessage(telegramId, text.slice(0, 3900));
      sent.push(...rows.map((r) => Number(r.charge_id)));
      for (const r of rows) {
        await supabaseAdmin.from('notification_log').insert({
          telegram_id: telegramId,
          client_id: r.client_id,
          notification_type: 'miniapp_debt_reminder',
          entity_type: 'client_charges',
          entity_id: r.charge_id
        });
      }
    }

    for (const ch of charges || []) {
      const id = Number(ch.charge_id);
      if (!sent.includes(id)) skipped.push(id);
    }

    await supabaseAdmin.rpc('miniapp_audit', {
      p_admin_tg_id: auth.telegramId,
      p_action: 'miniapp_bulk_remind_debts',
      p_details: { selected: chargeIds, sent, skipped }
    });

    return ok({ sent, skipped });
  } catch (e) {
    return fail(e);
  }
}
