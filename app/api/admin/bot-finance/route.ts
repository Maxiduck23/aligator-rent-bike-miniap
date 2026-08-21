import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function isoDate(value: string | null, fallback: string) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function diffDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
}

function classify(row: any) {
  const eventType = String(row.event_type || '');
  const action = String(row.action || '');
  const sign = String(row.sign || '');
  const amount = Number(row.amount || row.nominal_amount || 0);
  if (eventType === 'charge_created' || action === 'debt' || action === 'add_debt' || row.affects_cash === false) {
    return { kind: 'debt_created', cash: 0, nominal: Number(row.nominal_amount || amount) };
  }
  if (eventType === 'expense_paid' || sign === 'expense') {
    return { kind: 'expense', cash: Math.abs(Number(row.cash_amount ?? amount)), nominal: amount };
  }
  if (eventType === 'payment_received' || sign === 'income') {
    return { kind: 'income', cash: Math.abs(Number(row.cash_amount ?? amount)), nominal: amount };
  }
  return { kind: 'other', cash: 0, nominal: amount };
}

async function fetchAllFinanceRows(dateFrom: string, dateTo: string) {
  const pageSize = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('bot_finance_events')
      .select('*')
      .gte('event_date', dateFrom)
      .lte('event_date', dateTo)
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    if (all.length > 25000) throw new Error('Слишком большой диапазон: больше 25 000 финансовых записей');
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const today = pragueToday();
    const dateTo = isoDate(url.searchParams.get('date_to'), today);
    const defaultFromDate = new Date(`${dateTo}T12:00:00`);
    defaultFromDate.setDate(defaultFromDate.getDate() - 6);
    const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
    const dateFrom = isoDate(url.searchParams.get('date_from'), defaultFrom);

    if (dateFrom > dateTo) throw new Error('date_from не может быть позже date_to');
    const days = diffDays(dateFrom, dateTo);
    if (days < 1 || days > 732) throw new Error('Диапазон должен быть от 1 дня до 2 лет');

    const rows = await fetchAllFinanceRows(dateFrom, dateTo);
    const totals = rows.reduce(
      (acc: any, r: any) => {
        const c = classify(r);
        if (c.kind === 'income') acc.income += c.cash;
        if (c.kind === 'expense') acc.expense += c.cash;
        if (c.kind === 'debt_created') acc.debt_created += c.nominal;
        acc.count += 1;
        return acc;
      },
      { income: 0, expense: 0, debt_created: 0, count: 0 },
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
        count: 0,
      };
      prev.total += c.kind === 'debt_created' ? c.nominal : c.cash;
      prev.count += 1;
      byCategoryMap.set(key, prev);
    }

    const by_category = [...byCategoryMap.values()].sort((a, b) => b.total - a.total);
    const recent = rows.slice(0, 250).map((r: any) => ({ ...r, stats_kind: classify(r).kind }));

    return ok({ date_from: dateFrom, date_to: dateTo, days, totals, by_category, recent, total_rows: rows.length });
  } catch (e) {
    return fail(e);
  }
}
