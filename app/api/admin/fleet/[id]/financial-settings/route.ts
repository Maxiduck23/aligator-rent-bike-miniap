import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireAdmin(req);
    const { id } = await ctx.params;
    const bikeId = Number(id);
    if (!Number.isFinite(bikeId)) throw new Error('Bad bike_id');
    const body = await req.json();
    const acquisition = body.acquisition_cost === '' || body.acquisition_cost == null ? null : Number(body.acquisition_cost);
    if (acquisition != null && (!Number.isFinite(acquisition) || acquisition < 0)) throw new Error('Некорректная стоимость покупки');
    const acquiredAt = String(body.acquired_at || '').trim() || null;
    if (acquiredAt && !/^\d{4}-\d{2}-\d{2}$/.test(acquiredAt)) throw new Error('Некорректная дата покупки');

    const { data, error } = await supabaseAdmin.rpc('miniapp_set_bike_financial_settings_v23', {
      p_bike_id: bikeId,
      p_acquisition_cost: acquisition,
      p_acquired_at: acquiredAt,
      p_notes: String(body.notes || '').trim() || null,
      p_admin_tg_id: auth.telegramId,
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
