// Copy this file over app/api/admin/payments/manual/route.ts
import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const chargeIds = Array.isArray(body.charge_ids) ? body.charge_ids.map(Number).filter(Number.isFinite) : [];
    const auditChat = Number(process.env.PAYMENT_AUDIT_CHAT_ID || '-5156455929');
    const { data, error } = await supabaseAdmin.rpc('miniapp_record_manual_payment_v2', {
      p_client_id: requiredNumber(body.client_id, 'client_id'),
      p_amount: requiredNumber(body.amount, 'amount'),
      p_method: optionalString(body.method) || 'manual',
      p_payment_date: optionalString(body.payment_date),
      p_payment_category: optionalString(body.category) || 'auto',
      p_allocation_mode: optionalString(body.allocation_mode) || 'oldest',
      p_charge_ids: chargeIds,
      p_note: optionalString(body.note),
      p_admin_tg_id: auth.telegramId,
      p_audit_chat_id: Number.isFinite(auditChat) ? auditChat : null,
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
