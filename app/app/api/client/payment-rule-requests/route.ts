import { NextRequest } from 'next/server';
import { fail, ok, requiredNumber, optionalString } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const body = await req.json();
    if (!Array.isArray(body.parts) || body.parts.length === 0) throw new Error('parts is required');

    const { data, error } = await supabaseAdmin.rpc('miniapp_client_request_payment_rule_change', {
      p_client_tg_id: auth.telegramId,
      p_rental_id: requiredNumber(body.rental_id, 'rental_id'),
      p_monthly_amount: requiredNumber(body.monthly_amount, 'monthly_amount'),
      p_parts: body.parts,
      p_reason: optionalString(body.reason),
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
