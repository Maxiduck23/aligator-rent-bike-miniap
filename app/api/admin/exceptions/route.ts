import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { data, error } = await supabaseAdmin
      .from('miniapp_exceptions')
      .select('*')
      .order('severity', { ascending: false })
      .order('entity_id');
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}
