import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function lower(v: unknown) { return String(v ?? '').trim().toLowerCase(); }
function hasWarnings(row: any, kind: 'accounting' | 'technical' | 'financial') {
  const key = `${kind}_warnings`;
  return Array.isArray(row?.[key]) && row[key].length > 0;
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const q = lower(url.searchParams.get('q'));
    const status = lower(url.searchParams.get('status') || 'all');
    const problem = lower(url.searchParams.get('problem') || 'all');

    const { data, error } = await supabaseAdmin
      .from('miniapp_fleet_center_v23')
      .select('*')
      .order('bike_id', { ascending: true });
    if (error) throw error;

    const all = data || [];
    const rows = all.filter((r: any) => {
      if (status !== 'all' && lower(r.fleet_status) !== status) return false;
      if (problem !== 'all' && !hasWarnings(r, problem as any)) return false;
      if (!q) return true;
      const hay = [
        r.bike_id, r.bike_label, r.brand, r.model, r.db_status, r.fleet_status,
        r.current_rental_id, r.current_client_id, r.client_name, r.client_phone,
        ...(Array.isArray(r.battery_ids) ? r.battery_ids : []),
      ].filter((x) => x != null).join(' ').toLowerCase();
      return hay.includes(q.replace(/^#/, '')) || hay.includes(q);
    });

    const kpi = {
      total: all.length,
      rented: all.filter((r: any) => r.fleet_status === 'rented').length,
      free: all.filter((r: any) => r.fleet_status === 'free').length,
      service: all.filter((r: any) => r.fleet_status === 'service').length,
      inactive: all.filter((r: any) => r.fleet_status === 'inactive').length,
      other: all.filter((r: any) => r.fleet_status === 'other').length,
      accounting: all.filter((r: any) => hasWarnings(r, 'accounting')).length,
      technical: all.filter((r: any) => hasWarnings(r, 'technical')).length,
      financial: all.filter((r: any) => hasWarnings(r, 'financial')).length,
      current_debt: all.reduce((s: number, r: any) => s + Number(r.current_rental_debt || 0), 0),
      month_profit: all.reduce((s: number, r: any) => s + Number(r.month_profit || 0), 0),
    };

    return ok({ rows, kpi, total_rows: all.length, filtered_rows: rows.length });
  } catch (e) {
    return fail(e);
  }
}
