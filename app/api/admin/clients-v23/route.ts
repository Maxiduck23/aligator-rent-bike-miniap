import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function lower(v: unknown) { return String(v ?? '').trim().toLowerCase(); }

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const q = lower(url.searchParams.get('q'));
    const state = lower(url.searchParams.get('state') || 'all');

    const { data, error } = await supabaseAdmin
      .from('miniapp_client_profiles_v23')
      .select('*')
      .order('client_id', { ascending: false })
      .limit(1000);
    if (error) throw error;
    const all = data || [];

    const rows = all.filter((r: any) => {
      if (state === 'active' && Number(r.active_rental_count || 0) <= 0) return false;
      if (state === 'debt' && Number(r.open_debt_total || 0) <= 0) return false;
      if (state === 'overdue' && Number(r.overdue_total || 0) <= 0) return false;
      if (state === 'inactive' && Number(r.active_rental_count || 0) > 0) return false;
      if (!q) return true;
      const hay = [
        r.client_id,r.name,r.phone,r.email,r.address,r.doc_number,r.telegram_id,
        ...(Array.isArray(r.active_bike_ids) ? r.active_bike_ids : []),
      ].filter((x) => x != null).join(' ').toLowerCase();
      return hay.includes(q.replace(/^#/, '')) || hay.includes(q);
    });

    return ok({
      rows,
      kpi: {
        total: all.length,
        active: all.filter((r: any) => Number(r.active_rental_count || 0) > 0).length,
        with_debt: all.filter((r: any) => Number(r.open_debt_total || 0) > 0).length,
        overdue: all.filter((r: any) => Number(r.overdue_total || 0) > 0).length,
        total_debt: all.reduce((s: number, r: any) => s + Number(r.open_debt_total || 0), 0),
      },
      filtered_rows: rows.length,
    });
  } catch (e) {
    return fail(e);
  }
}
