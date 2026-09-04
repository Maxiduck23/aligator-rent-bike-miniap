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
      // Direct rentals table is intentional: legacy miniapp_active_rentals views may not
      // expose v2 fields such as plan_code/recurring_rent/contract_terms_snapshot.
      supabaseAdmin
        .from('rentals')
        .select('*, clients(id,name,phone,telegram_id)')
        .eq('bike_id', bikeId)
        .eq('status', 'active')
        .order('id', { ascending: false }),
      supabaseAdmin.from('miniapp_debt_items').select('*').eq('bike_id', bikeId).order('due_date'),
      supabaseAdmin.from('miniapp_payment_rules').select('*').eq('bike_id', bikeId).order('id', { ascending: false }),
      supabaseAdmin.from('miniapp_batteries').select('*').eq('bike_id', bikeId).order('id'),
    ]);

    for (const r of [bike, rentals, charges, rules, batteries]) if (r.error) throw r.error;

    const activeRentals = (rentals.data || []).map((r: any) => ({
      ...r,
      client_name: r.clients?.name || null,
      client_phone: r.clients?.phone || null,
      client_telegram_id: r.clients?.telegram_id || null,
      clients: undefined,
    }));

    return ok({
      bike: bike.data,
      active_rentals: activeRentals,
      charges: charges.data || [],
      payment_rules: rules.data || [],
      batteries: batteries.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
