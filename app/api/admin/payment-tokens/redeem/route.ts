import { NextRequest } from 'next/server';
import { fail, ok, optionalString } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const code = String(body.code || '').replace(/\D/g, '');
    if (code.length !== 8) throw new Error('Код оплаты должен содержать 8 цифр');
    const amount = body.amount === null || body.amount === undefined || body.amount === '' ? null : Number(body.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) throw new Error('Сумма должна быть больше 0');

    const auditChat = Number(process.env.PAYMENT_AUDIT_CHAT_ID || '-5156455929');
    const { data, error } = await supabaseAdmin.rpc('miniapp_redeem_payment_token', {
      p_code: code,
      p_amount: amount,
      p_category: optionalString(body.category),
      p_method: optionalString(body.method) || 'cash',
      p_source: 'payment_token_miniapp',
      p_admin_tg_id: auth.telegramId,
      p_chat_id: null,
      p_message_id: null,
      p_raw_text: `Mini App redeem code ****${code.slice(-4)}`,
      p_enqueue_telegram: true,
      p_audit_chat_id: Number.isFinite(auditChat) ? auditChat : null,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
