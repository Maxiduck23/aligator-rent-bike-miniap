import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const status = searchParams.get('status') || 'all';
    const health = searchParams.get('health') || 'all';

    let query = supabaseAdmin
      .from('miniapp_bike_health_summary')
      .select('*')
      .order('bike_id');

    if (status !== 'all') query = query.eq('bike_status', status);
    if (health !== 'all') query = query.eq('health_status', health);
    if (q) {
      const id = Number(q.replace('#', '').trim());
      if (Number.isFinite(id)) {
        query = query.or(`bike_id.eq.${id},bike_label.ilike.%${q}%`);
      } else {
        query = query.ilike('bike_label', `%${q}%`);
      }
    }

    const { data: bikes, error } = await query.limit(300);
    if (error) throw error;

    const bikeIds = (bikes || []).map((b: any) => b.bike_id);
    const [repairsRes, batteriesRes, tasksRes, reportsRes] = await Promise.all([
      bikeIds.length
        ? supabaseAdmin.from('bike_service_events').select('*').in('bike_id', bikeIds).order('performed_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null } as any),
      bikeIds.length
        ? supabaseAdmin.from('miniapp_bike_battery_health').select('*').in('bike_id', bikeIds).order('battery_id')
        : Promise.resolve({ data: [], error: null } as any),
      bikeIds.length
        ? supabaseAdmin.from('bike_maintenance_tasks').select('*').in('bike_id', bikeIds).eq('status', 'open').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      bikeIds.length
        ? supabaseAdmin.from('bike_odometer_reports').select('*').in('bike_id', bikeIds).order('reported_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    for (const r of [repairsRes, batteriesRes, tasksRes, reportsRes]) {
      if (r.error) throw r.error;
    }

    return ok({
      bikes: bikes || [],
      service_events: repairsRes.data || [],
      batteries: batteriesRes.data || [],
      tasks: tasksRes.data || [],
      odometer_reports: reportsRes.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
