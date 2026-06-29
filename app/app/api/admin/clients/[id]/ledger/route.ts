import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const params = await ctx.params;
    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) throw new Error('client_id must be a number');

    const [clientRes, summaryRes, categoryRes, chargesRes, paymentsRes, allocationsRes, rulesRes] = await Promise.all([
      supabaseAdmin.from('miniapp_clients').select('*').eq('id', clientId).maybeSingle(),
      supabaseAdmin.from('miniapp_client_balance_summary').select('*').eq('client_id', clientId).maybeSingle(),
      supabaseAdmin.from('miniapp_client_category_balances').select('*').eq('client_id', clientId).order('category'),
      supabaseAdmin.from('miniapp_debt_items').select('*').eq('client_id', clientId).order('due_date'),
      supabaseAdmin.from('client_payments').select('*').eq('client_id', clientId).order('payment_date', { ascending: false }).limit(100),
      supabaseAdmin.from('miniapp_payment_allocations_view').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
      supabaseAdmin.from('miniapp_payment_rules').select('*').eq('client_id', clientId).order('id', { ascending: false }).limit(20),
    ]);

    for (const r of [clientRes, summaryRes, categoryRes, chargesRes, paymentsRes, allocationsRes, rulesRes]) {
      if (r.error) throw r.error;
    }

    return ok({
      client: clientRes.data,
      summary: summaryRes.data,
      categories: categoryRes.data || [],
      charges: chargesRes.data || [],
      payments: paymentsRes.data || [],
      allocations: allocationsRes.data || [],
      payment_rules: rulesRes.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
