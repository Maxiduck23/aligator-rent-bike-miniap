import { NextRequest } from 'next/server';
import { fail, ok, optionalString } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireAdmin(req);
    const params = await ctx.params;
    const clientId = Number(params.id);
    if (!Number.isFinite(clientId)) throw new Error('client_id must be a number');

    const body = await req.json().catch(() => ({}));
    const { data, error } = await supabaseAdmin.rpc('miniapp_allocate_client_advance', {
      p_client_id: clientId,
      p_admin_tg_id: auth.telegramId,
      p_charge_category: optionalString(body.category) || 'auto',
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
