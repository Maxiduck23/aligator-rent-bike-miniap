import { NextRequest } from 'next/server';
import { fail, ok, requiredString } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const chargeIds = Array.isArray(body.charge_ids) ? body.charge_ids.map(Number).filter(Number.isFinite) : [];
    if (!chargeIds.length) throw new Error('charge_ids is required');

    const { data, error } = await supabaseAdmin.rpc('miniapp_exclude_charges', {
      p_charge_ids: chargeIds,
      p_reason: requiredString(body.reason || 'excluded from miniapp debt list', 'reason'),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
