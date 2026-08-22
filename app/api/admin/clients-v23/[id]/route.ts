import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await ctx.params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) throw new Error('Bad client_id');

    const profileRes = await supabaseAdmin
      .from('miniapp_client_profiles_v23')
      .select('*')
      .eq('client_id', clientId)
      .single();
    if (profileRes.error) throw profileRes.error;

    const [rentalsRes, assignmentsRes, chargesRes, truthRes, paymentsRes, requestsRes, mediaRes, financeRes] = await Promise.all([
      supabaseAdmin.from('rentals').select('*').eq('client_id', clientId).order('id', { ascending: false }).limit(200),
      supabaseAdmin.from('rental_bike_assignments').select('*, bikes(id,brand,model,status), rentals(id,status,start_date,end_date,price,deposit)').eq('client_id', clientId).order('started_at', { ascending: false }).limit(250),
      supabaseAdmin.from('client_charges').select('*').eq('client_id', clientId).order('due_date', { ascending: false }).order('id', { ascending: false }).limit(300),
      supabaseAdmin.from('miniapp_charge_allocation_truth_v221').select('charge_id,effective_paid_amount,effective_debt_left,effective_status,effective_difference').eq('client_id', clientId),
      supabaseAdmin.from('client_payments').select('*').eq('client_id', clientId).order('payment_date', { ascending: false }).order('id', { ascending: false }).limit(300),
      supabaseAdmin.from('client_requests').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(150),
      supabaseAdmin.from('client_media').select('id,client_id,media_type,provider,file_name,mime_type,size_bytes,sha256,is_current,is_sensitive,created_at,deleted_at,metadata').eq('client_id', clientId).is('deleted_at', null).order('created_at', { ascending: false }),
      supabaseAdmin.from('bot_finance_events').select('*').eq('client_id', clientId).order('event_date', { ascending: false }).order('id', { ascending: false }).limit(250),
    ]);
    for (const r of [rentalsRes,assignmentsRes,chargesRes,truthRes,paymentsRes,requestsRes,mediaRes,financeRes]) {
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
    const openCharges = charges.filter((c: any) => Number(c.effective_debt_left || 0) > 0);

    return ok({
      profile: profileRes.data,
      rentals: rentalsRes.data || [],
      assignment_history: assignmentsRes.data || [],
      charges,
      open_charges: openCharges,
      payments: paymentsRes.data || [],
      requests: requestsRes.data || [],
      media: mediaRes.data || [],
      finance_events: financeRes.data || [],
    });
  } catch (e) {
    return fail(e);
  }
}
