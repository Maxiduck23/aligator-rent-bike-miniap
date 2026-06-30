import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function safeDays(value: string | null) {
  const n = Number(value || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.round(n), 1), 90);
}

function classify(row: any) {
  const eventType = String(row.event_type || '');
  const action = String(row.action || '');
  const sign = String(row.sign || '');
  const amount = Number(row.amount || row.nominal_amount || 0);
  if (eventType === 'charge_created' || action === 'debt' || row.affects_cash === false) {
    return { kind: 'debt_created', cash: 0, nominal: Number(row.nominal_amount || amount) };
  }
  if (eventType === 'expense_paid' || sign === 'expense') {
    return { kind: 'expense', cash: Math.abs(Number(row.cash_amount || amount)), nominal: amount };
  }
  if (eventType === 'payment_received' || sign === 'income') {
    return { kind: 'income', cash: Math.abs(Number(row.cash_amount || amount)), nominal: amount };
  }
  return { kind: 'other', cash: 0, nominal: amount };
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const days = safeDays(url.searchParams.get('days'));

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceDate = since.toISOString().slice(0, 10);

    const recentRes = await supabaseAdmin
      .from('bot_finance_events')
      .select('*')
      .gte('event_date', sinceDate)
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(150);
    if (recentRes.error) throw recentRes.error;

    const rows = recentRes.data || [];
    const totals = rows.reduce(
      (acc: any, r: any) => {
        const c = classify(r);
        if (c.kind === 'income') acc.income += c.cash;
        if (c.kind === 'expense') acc.expense += c.cash;
        if (c.kind === 'debt_created') acc.debt_created += c.nominal;
        acc.count += 1;
        return acc;
      },
      { income: 0, expense: 0, debt_created: 0, count: 0 }
    );

    const byCategoryMap = new Map<string, any>();
    for (const r of rows) {
      const c = classify(r);
      const key = `${c.kind}:${r.category}`;
      const prev = byCategoryMap.get(key) || {
        kind: c.kind,
        sign: c.kind === 'expense' ? 'expense' : c.kind === 'income' ? 'income' : 'debt',
        category: r.category,
        category_label: r.category_label || r.category,
        total: 0,
        count: 0
      };
      prev.total += c.kind === 'debt_created' ? c.nominal : c.cash;
      prev.count += 1;
      byCategoryMap.set(key, prev);
    }

    const by_category = [...byCategoryMap.values()].sort((a, b) => b.total - a.total);
    const recent = rows.map((r: any) => ({ ...r, stats_kind: classify(r).kind }));

    return ok({ days, totals, by_category, recent });
  } catch (e) {
    return fail(e);
  }
}
