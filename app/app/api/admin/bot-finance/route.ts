import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function safeDays(value: string | null) {
  const n = Number(value || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.round(n), 1), 90);
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
      .limit(100);
    if (recentRes.error) throw recentRes.error;

    const rows = recentRes.data || [];
    const totals = rows.reduce(
      (acc: any, r: any) => {
        const amount = Number(r.amount || 0);
        if (r.sign === 'income') acc.income += amount;
        if (r.sign === 'expense') acc.expense += amount;
        acc.count += 1;
        return acc;
      },
      { income: 0, expense: 0, count: 0 }
    );

    const byCategoryMap = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.sign}:${r.category}`;
      const prev = byCategoryMap.get(key) || {
        sign: r.sign,
        category: r.category,
        category_label: r.category_label || r.category,
        total: 0,
        count: 0
      };
      prev.total += Number(r.amount || 0);
      prev.count += 1;
      byCategoryMap.set(key, prev);
    }

    const by_category = [...byCategoryMap.values()].sort((a, b) => b.total - a.total);

    return ok({ days, totals, by_category, recent: rows });
  } catch (e) {
    return fail(e);
  }
}
