import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const status = searchParams.get('status');

    let query = supabaseAdmin.from('miniapp_bike_cards').select('*').order('id');
    if (status && status !== 'all') query = query.eq('status', status);
    if (q) {
      const id = Number(q);
      if (Number.isFinite(id)) {
        query = query.or(`id.eq.${id},bike_label.ilike.%${q}%`);
      } else {
        query = query.ilike('bike_label', `%${q}%`);
      }
    }

    const { data, error } = await query.limit(300);
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}
