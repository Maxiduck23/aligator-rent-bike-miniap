import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function pragueDate(d = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function addDays(iso: string, diff: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const today = pragueDate();
    const since = addDays(today, -29);
    const [bikesRes, batRes, reqRes, debtRes, finRes] = await Promise.all([
      supabaseAdmin.from('miniapp_bike_cards').select('id,status,active_rental_id,warnings'),
      supabaseAdmin.from('miniapp_battery_overview_v22').select('battery_id,overview_status,warnings,effective_bike_id'),
      supabaseAdmin.from('client_requests').select('id,status,request_type,priority').in('status', ['new','in_progress']),
      supabaseAdmin.from('miniapp_debt_items').select('charge_id,debt_left,overdue_days,is_excluded'),
      supabaseAdmin.from('bot_finance_events')
        .select('event_date,sign,cash_amount,amount,affects_cash,category')
        .gte('event_date', since)
        .lte('event_date', today)
        .order('event_date', { ascending: true }),
    ]);
    for (const r of [bikesRes, batRes, reqRes, debtRes, finRes]) if (r.error) throw r.error;

    const bikes = bikesRes.data || [];
    const batteries = batRes.data || [];
    const requests = reqRes.data || [];
    const debts = (debtRes.data || []).filter((x: any) => !x.is_excluded);
    const finance = finRes.data || [];

    const byDay = new Map<string, { date: string; income: number; expense: number; profit: number }>();
    for (let i = 0; i < 30; i += 1) {
      const date = addDays(since, i);
      byDay.set(date, { date, income: 0, expense: 0, profit: 0 });
    }
    let todayIncome = 0, todayExpense = 0;
    for (const row of finance as any[]) {
      if (row.affects_cash === false) continue;
      const amount = Number(row.cash_amount ?? row.amount ?? 0);
      const bucket = byDay.get(String(row.event_date));
      if (!bucket) continue;
      if (row.sign === 'income') bucket.income += amount;
      if (row.sign === 'expense') bucket.expense += amount;
      bucket.profit = bucket.income - bucket.expense;
      if (String(row.event_date) === today) {
        if (row.sign === 'income') todayIncome += amount;
        if (row.sign === 'expense') todayExpense += amount;
      }
    }

    return ok({
      generated_at: new Date().toISOString(),
      today,
      kpi: {
        bikes_total: bikes.length,
        bikes_rented: bikes.filter((b: any) => b.active_rental_id != null).length,
        bikes_free: bikes.filter((b: any) => b.active_rental_id == null && b.status !== 'repair').length,
        bikes_problem: bikes.filter((b: any) => Array.isArray(b.warnings) && b.warnings.length).length,
        batteries_total: batteries.length,
        batteries_assigned: batteries.filter((b: any) => b.overview_status === 'assigned').length,
        batteries_free: batteries.filter((b: any) => b.overview_status === 'free' || b.overview_status === 'legacy_link').length,
        batteries_problem: batteries.filter((b: any) => Array.isArray(b.warnings) && b.warnings.length).length,
        requests_new: requests.filter((r: any) => r.status === 'new').length,
        requests_in_progress: requests.filter((r: any) => r.status === 'in_progress').length,
        overdue_count: debts.filter((d: any) => Number(d.overdue_days || 0) > 0).length,
        overdue_total: debts.filter((d: any) => Number(d.overdue_days || 0) > 0).reduce((s: number, d: any) => s + Number(d.debt_left || 0), 0),
        today_income: todayIncome,
        today_expense: todayExpense,
        today_profit: todayIncome - todayExpense,
      },
      finance_30d: [...byDay.values()],
      request_types: requests.reduce((acc: Record<string, number>, r: any) => {
        acc[r.request_type || 'other_request'] = (acc[r.request_type || 'other_request'] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (e) {
    return fail(e);
  }
}
