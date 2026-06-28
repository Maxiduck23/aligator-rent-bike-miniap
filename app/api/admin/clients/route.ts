import { NextRequest } from 'next/server';
import { fail, ok, optionalNumber, optionalString, requiredString } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const q = new URL(req.url).searchParams.get('q')?.trim();
    let query = supabaseAdmin.from('miniapp_clients').select('*').order('id', { ascending: false }).limit(200);
    if (q) {
      const id = Number(q);
      if (Number.isFinite(id)) query = query.or(`id.eq.${id},name.ilike.%${q}%`);
      else query = query.ilike('name', `%${q}%`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_create_client', {
      p_name: requiredString(body.name, 'name'),
      p_phone: optionalString(body.phone),
      p_telegram_id: optionalNumber(body.telegram_id),
      p_notes: optionalString(body.notes),
      p_admin_tg_id: auth.telegramId
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
