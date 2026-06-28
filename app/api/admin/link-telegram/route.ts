import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_link_telegram', {
      p_client_id: requiredNumber(body.client_id, 'client_id'),
      p_telegram_id: requiredNumber(body.telegram_id, 'telegram_id'),
      p_username: optionalString(body.username),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
