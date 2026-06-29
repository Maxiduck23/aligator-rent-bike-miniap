import { NextRequest } from 'next/server';
import { fail, ok, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const year = requiredNumber(body.year, 'year');
    const month = requiredNumber(body.month, 'month');

    if (year < 2020 || year > 2100) throw new Error('year must be 2020-2100');
    if (month < 1 || month > 12) throw new Error('month must be 1-12');

    const { data, error } = await supabaseAdmin.rpc('miniapp_generate_month_charges_by_bike', {
      p_bike_id: requiredNumber(body.bike_id, 'bike_id'),
      p_year: year,
      p_month: month,
      p_admin_tg_id: auth.telegramId
    });

    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
