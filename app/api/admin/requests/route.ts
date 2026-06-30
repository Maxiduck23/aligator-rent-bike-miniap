import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'new';
    let query = supabaseAdmin
      .from('client_requests')
      .select('*, clients:client_id(id,name,phone,telegram_id)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status !== 'all') query = query.eq('status', status);
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
    const requestId = requiredNumber(body.request_id, 'request_id');
    const status = optionalString(body.status) || 'in_progress';
    const adminNote = optionalString(body.admin_note);
    const allowed = new Set(['new', 'in_progress', 'approved', 'rejected', 'closed', 'cancelled']);
    if (!allowed.has(status)) throw new Error('bad status');
    const patch: any = {
      status,
      admin_note: adminNote,
      updated_at: new Date().toISOString(),
      decided_by_telegram_id: auth.telegramId,
    };
    if (['closed', 'rejected', 'cancelled', 'approved'].includes(status)) {
      patch.closed_at = new Date().toISOString();
    }
    const { data, error } = await supabaseAdmin
      .from('client_requests')
      .update(patch)
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
