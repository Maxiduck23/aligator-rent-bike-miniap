import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const { data: client } = await supabaseAdmin
      .from('miniapp_client_auth_map')
      .select('*')
      .eq('telegram_id', auth.telegramId)
      .maybeSingle();

    return ok({
      telegram_id: auth.telegramId,
      is_admin: auth.isAdmin,
      is_worker: auth.isWorker,
      role: auth.role,
      real_role: auth.realRole,
      is_role_override: auth.isRoleOverride,
      can_test_worker: auth.canTestWorker,
      user: auth.user,
      client: client || null,
    });
  } catch (e) {
    return fail(e);
  }
}
