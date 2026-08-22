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

    const bikeRes = await supabaseAdmin
      .from('miniapp_fleet_center_v23')
      .select('*')
      .eq('bike_id', bikeId)
      .single();
    if (bikeRes.error) throw bikeRes.error;
    const bike: any = bikeRes.data;

    const assignmentRes = await supabaseAdmin
      .from('rental_bike_assignments')
      .select('*, rentals(id,status,start_date,end_date,price,deposit), clients(id,name,phone,telegram_id)')
      .eq('bike_id', bikeId)
      .order('started_at', { ascending: false })
      .limit(150);
    if (assignmentRes.error) throw assignmentRes.error;

    const currentRentalId = Number(bike?.current_rental_id || 0) || null;
    const currentClientId = Number(bike?.current_client_id || 0) || null;

    const empty = Promise.resolve({ data: [], error: null } as any);
    const [chargesRes, truthRes, paymentsRes, batteriesRes, servicesRes, tasksRes, requestsRes, financeRes, settingsRes] = await Promise.all([
      currentRentalId && currentClientId
        ? supabaseAdmin.from('client_charges').select('*').eq('rental_id', currentRentalId).eq('client_id', currentClientId).order('due_date', { ascending: false }).limit(150)
        : empty,
      currentRentalId && currentClientId
        ? supabaseAdmin.from('miniapp_charge_allocation_truth_v221').select('charge_id,effective_paid_amount,effective_debt_left,effective_status,effective_difference').eq('rental_id', currentRentalId).eq('client_id', currentClientId)
        : empty,
      currentRentalId && currentClientId
        ? supabaseAdmin.from('client_payments').select('*').eq('rental_id', currentRentalId).eq('client_id', currentClientId).order('payment_date', { ascending: false }).order('id', { ascending: false }).limit(150)
        : empty,
      supabaseAdmin.from('miniapp_battery_overview_v22').select('*').eq('effective_bike_id', bikeId).order('battery_id'),
      supabaseAdmin.from('bike_service_events').select('*').eq('bike_id', bikeId).order('performed_at', { ascending: false }).limit(80),
      supabaseAdmin.from('bike_maintenance_tasks').select('*').eq('bike_id', bikeId).order('created_at', { ascending: false }).limit(80),
      supabaseAdmin.from('client_requests').select('*').eq('bike_id', bikeId).order('created_at', { ascending: false }).limit(80),
      supabaseAdmin.from('bot_finance_events').select('*').eq('bike_id', bikeId).order('event_date', { ascending: false }).order('id', { ascending: false }).limit(200),
      supabaseAdmin.from('bike_financial_settings').select('*').eq('bike_id', bikeId).maybeSingle(),
    ]);
    for (const r of [chargesRes,truthRes,paymentsRes,batteriesRes,servicesRes,tasksRes,requestsRes,financeRes,settingsRes]) {
      if (r.error) throw r.error;
    }

    const truthByCharge = new Map((truthRes.data || []).map((t: any) => [Number(t.charge_id), t]));
    const charges = (chargesRes.data || []).map((c: any) => {
      const t: any = truthByCharge.get(Number(c.id));
      return {
        ...c,
        effective_paid_amount: Number(t?.effective_paid_amount || 0),
        effective_debt_left: Number(t?.effective_debt_left ?? Math.max(Number(c.amount || 0) - Number(c.paid_amount || 0), 0)),
        effective_status: t?.effective_status || c.status,
        finance_cache_difference: Number(t?.effective_difference || 0),
      };
    });

    const rentalIds = [...new Set((assignmentRes.data || []).map((x: any) => Number(x.rental_id)).filter(Boolean))];
    const contractRes = rentalIds.length
      ? await supabaseAdmin.from('rental_contract_events').select('*').in('rental_id', rentalIds).order('created_at', { ascending: false }).limit(200)
      : ({ data: [], error: null } as any);
    if (contractRes.error) throw contractRes.error;

    return ok({
      bike,
      current_scope: {
        rental_id: currentRentalId,
        client_id: currentClientId,
        note: 'charges/payments below are restricted to current rental + current client only',
      },
      assignment_history: assignmentRes.data || [],
      charges,
      payments: paymentsRes.data || [],
      batteries: batteriesRes.data || [],
      service_events: servicesRes.data || [],
      maintenance_tasks: tasksRes.data || [],
      requests: requestsRes.data || [],
      finance_events: financeRes.data || [],
      financial_settings: { acquisition_cost: bike?.acquisition_cost ?? null, acquired_at: bike?.acquired_at ?? null, notes: settingsRes.data?.notes || null },
      contract_events: contractRes.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
