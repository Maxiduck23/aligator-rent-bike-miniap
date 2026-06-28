import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const includeExcluded = searchParams.get('include_excluded') === '1';
    const onlyOverdue = searchParams.get('only_overdue') !== '0';
    const bikeId = searchParams.get('bike_id');
    const clientId = searchParams.get('client_id');

    let query = supabaseAdmin.from('miniapp_debt_items').select('*').order('due_date');
    if (!includeExcluded) query = query.eq('is_excluded', false);
    if (onlyOverdue) query = query.lte('due_date', new Date().toISOString().slice(0, 10));
    if (bikeId) query = query.eq('bike_id', Number(bikeId));
    if (clientId) query = query.eq('client_id', Number(clientId));

    const { data, error } = await query.limit(500);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}
