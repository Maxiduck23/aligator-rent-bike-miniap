import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const code = String(new URL(req.url).searchParams.get('code') || '').replace(/\D/g, '');
    if (code.length !== 8) throw new Error('Код наличных должен содержать 8 цифр');
    const { data, error } = await supabaseAdmin.rpc('miniapp_cash_token_preview_v22', { p_code: code });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const code = String(body.code || '').replace(/\D/g, '');
    if (code.length !== 8) throw new Error('Код наличных должен содержать 8 цифр');
    const received = Number(body.received_amount);
    if (!Number.isFinite(received) || received <= 0) throw new Error('Укажи фактически полученную сумму');
    const auditChat = Number(process.env.PAYMENT_AUDIT_CHAT_ID || '-5156455929');
    const { data, error } = await supabaseAdmin.rpc('miniapp_redeem_cash_token_v22', {
      p_code: code,
      p_received_amount: received,
      p_admin_tg_id: auth.telegramId,
      p_audit_chat_id: Number.isFinite(auditChat) ? auditChat : null,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
