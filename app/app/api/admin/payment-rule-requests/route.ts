import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    let query = supabaseAdmin.from('miniapp_payment_rule_change_requests').select('*').order('created_at', { ascending: false });
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query.limit(200);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_admin_decide_payment_rule_change', {
      p_request_id: requiredNumber(body.request_id, 'request_id'),
      p_decision: optionalString(body.decision) || 'reject',
      p_admin_note: optionalString(body.admin_note),
      p_admin_tg_id: auth.telegramId,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
