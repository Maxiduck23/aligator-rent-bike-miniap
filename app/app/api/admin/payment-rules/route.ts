import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    if (!Array.isArray(body.parts) || body.parts.length === 0) throw new Error('parts is required');

    const { data, error } = await supabaseAdmin.rpc('miniapp_set_payment_rule_by_bike', {
      p_bike_id: requiredNumber(body.bike_id, 'bike_id'),
      p_monthly_amount: requiredNumber(body.monthly_amount, 'monthly_amount'),
      p_parts: body.parts,
      p_grace_days: Number(body.grace_days || 0),
      p_admin_only: Boolean(body.admin_only || false),
      p_allow_client_edit: Boolean(body.allow_client_edit || false),
      p_requires_admin_approval: Boolean(body.requires_admin_approval || false),
      p_note: optionalString(body.note),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
