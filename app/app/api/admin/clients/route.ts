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
      const safe = q.replace(/[,()]/g, ' ');
      const parts = [
        `name.ilike.%${safe}%`,
        `phone.ilike.%${safe}%`,
        `email.ilike.%${safe}%`,
        `address.ilike.%${safe}%`,
        `doc_number.ilike.%${safe}%`
      ];
      if (Number.isFinite(id)) parts.unshift(`id.eq.${id}`);
      query = query.or(parts.join(','));
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
      p_admin_tg_id: auth.telegramId,
      p_email: optionalString(body.email),
      p_address: optionalString(body.address),
      p_doc_type: optionalString(body.doc_type),
      p_doc_number: optionalString(body.doc_number)
    });
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
