import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function monthKey(value: string | null | undefined) {
  const s = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 7);
}

function computeFinanceStats(charges: any[], payments: any[]) {
  const months = new Map<string, any>();
  function row(key: string) {
    if (!months.has(key)) months.set(key, { month: key, charged: 0, paid: 0, open_debt: 0, advance: 0, balance: 0, charges_count: 0, payments_count: 0 });
    return months.get(key);
  }
  const all = { charged: 0, paid: 0, open_debt: 0, advance: 0, balance: 0, charges_count: 0, payments_count: 0 };
  for (const ch of charges || []) {
    const status = String(ch.status || '');
    if (status === 'excluded' || status === 'cancelled' || status === 'canceled') continue;
    const amount = Number(ch.amount || 0);
    const paidAmount = Number(ch.paid_amount || 0);
    const open = Math.max(amount - paidAmount, 0);
    const key = monthKey(ch.period_start || ch.due_date || ch.created_at);
    const r = row(key);
    r.charged += amount;
    r.open_debt += status === 'paid' ? 0 : open;
    r.charges_count += 1;
    all.charged += amount;
    all.open_debt += status === 'paid' ? 0 : open;
    all.charges_count += 1;
  }
  for (const p of payments || []) {
    const amount = Number(p.amount || 0);
    const key = monthKey(p.payment_date || p.created_at);
    const r = row(key);
    r.paid += amount;
    r.payments_count += 1;
    all.paid += amount;
    all.payments_count += 1;
  }
  for (const r of months.values()) {
    r.balance = r.paid - r.charged;
    r.advance = Math.max(r.balance, 0);
    r.open_debt = Math.max(r.open_debt, Math.max(r.charged - r.paid, 0));
  }
  all.balance = all.paid - all.charged;
  all.advance = Math.max(all.balance, 0);
  all.open_debt = Math.max(all.open_debt, Math.max(all.charged - all.paid, 0));
  const current_month = new Date().toISOString().slice(0, 7);
  const history = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  return { current_month, current: months.get(current_month) || row(current_month), all_time: all, history };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const params = await ctx.params;
    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) throw new Error('client_id must be a number');

    const [clientRes, summaryRes, categoryRes, chargesRes, allChargesRes, paymentsRes, allocationsRes, rulesRes] = await Promise.all([
      supabaseAdmin.from('miniapp_clients').select('*').eq('id', clientId).maybeSingle(),
      supabaseAdmin.from('miniapp_client_balance_summary').select('*').eq('client_id', clientId).maybeSingle(),
      supabaseAdmin.from('miniapp_client_category_balances').select('*').eq('client_id', clientId).order('category'),
      supabaseAdmin.from('miniapp_debt_items').select('*').eq('client_id', clientId).order('due_date'),
      supabaseAdmin.from('client_charges').select('*').eq('client_id', clientId).order('due_date', { ascending: false }).limit(1000),
      supabaseAdmin.from('client_payments').select('*').eq('client_id', clientId).order('payment_date', { ascending: false }).limit(1000),
      supabaseAdmin.from('miniapp_payment_allocations_view').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
      supabaseAdmin.from('miniapp_payment_rules').select('*').eq('client_id', clientId).order('id', { ascending: false }).limit(20),
    ]);

    for (const r of [clientRes, summaryRes, categoryRes, chargesRes, allChargesRes, paymentsRes, allocationsRes, rulesRes]) {
      if (r.error) throw r.error;
    }

    return ok({
      client: clientRes.data,
      summary: summaryRes.data,
      categories: categoryRes.data || [],
      charges: chargesRes.data || [],
      all_charges: allChargesRes.data || [],
      payments: paymentsRes.data || [],
      allocations: allocationsRes.data || [],
      payment_rules: rulesRes.data || [],
      finance_stats: computeFinanceStats(allChargesRes.data || [], paymentsRes.data || []),
    });
  } catch (e) {
    return fail(e);
  }
}
