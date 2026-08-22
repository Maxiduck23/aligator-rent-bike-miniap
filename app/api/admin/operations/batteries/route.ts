import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { data, error } = await supabaseAdmin
      .from('miniapp_battery_overview_v22')
      .select('*')
      .order('effective_bike_id', { ascending: true, nullsFirst: false })
      .order('battery_id', { ascending: true });
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}
