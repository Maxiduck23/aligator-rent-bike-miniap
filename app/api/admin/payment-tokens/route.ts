import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const code = String(url.searchParams.get('code') || '').replace(/\D/g, '');
    if (code) {
      if (code.length !== 8) throw new Error('Код оплаты должен содержать 8 цифр');
      const { data, error } = await supabaseAdmin.rpc('miniapp_payment_token_preview', { p_code: code });
      if (error) throw error;
      return ok(data);
    }

    const { data, error } = await supabaseAdmin
      .from('payment_tokens')
      .select('id,token_last4,client_id,rental_id,charge_id,amount,purpose,currency,status,created_at,expires_at,redeemed_at,payment_id')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}
