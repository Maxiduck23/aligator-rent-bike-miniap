import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await ctx.params;
    const bikeId = Number(id);
    if (!Number.isFinite(bikeId)) throw new Error('Bad bike_id');

    const [bike, rentals, charges, rules, batteries] = await Promise.all([
      supabaseAdmin.from('miniapp_bike_cards').select('*').eq('id', bikeId).single(),
      supabaseAdmin.from('miniapp_active_rentals').select('*').eq('bike_id', bikeId),
      supabaseAdmin.from('miniapp_debt_items').select('*').eq('bike_id', bikeId).order('due_date'),
      supabaseAdmin.from('miniapp_payment_rules').select('*').eq('bike_id', bikeId).order('id', { ascending: false }),
      supabaseAdmin.from('miniapp_batteries').select('*').eq('bike_id', bikeId).order('id')
    ]);

    if (bike.error) throw bike.error;
    if (rentals.error) throw rentals.error;
    if (charges.error) throw charges.error;
    if (rules.error) throw rules.error;
    if (batteries.error) throw batteries.error;

    return ok({
      bike: bike.data,
      active_rentals: rentals.data || [],
      charges: charges.data || [],
      payment_rules: rules.data || [],
      batteries: batteries.data || []
    });
  } catch (e) {
    return fail(e);
  }
}
