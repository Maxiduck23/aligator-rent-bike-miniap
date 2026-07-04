import { NextRequest } from 'next/server';
import { fail, ok, requiredNumber, optionalString } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validatePaymentPlanInput } from '@/lib/paymentPlan';

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const body = await req.json();
    validatePaymentPlanInput({
      month: body.month,
      parts: body.parts,
      monthlyAmount: requiredNumber(body.monthly_amount, 'monthly_amount'),
    });

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
