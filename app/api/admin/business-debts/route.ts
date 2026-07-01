import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'open';
    let query = supabaseAdmin
      .from('business_debts')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: false });
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query.limit(200);
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
    const action = optionalString(body.action) || 'create';

    if (action === 'status') {
      const id = requiredNumber(body.id, 'id');
      const status = optionalString(body.status) || 'closed';
      const { data, error } = await supabaseAdmin
        .from('business_debts')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return ok(data);
    }

    const row = {
      counterparty_name: optionalString(body.counterparty_name) || 'Без имени',
      direction: optionalString(body.direction) || 'receivable',
      amount: requiredNumber(body.amount, 'amount'),
      currency: optionalString(body.currency) || 'CZK',
      category: optionalString(body.category) || 'other',
      due_date: optionalString(body.due_date),
      notes: optionalString(body.notes),
      status: optionalString(body.status) || 'open',
      created_by_telegram_id: auth.telegramId,
    };
    const { data, error } = await supabaseAdmin
      .from('business_debts')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
