import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function optNumber(v: unknown) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Некорректное число');
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const b = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_edit_rental_contract', {
      p_rental_id: requiredNumber(b.rental_id, 'rental_id'),
      p_client_id: optNumber(b.client_id),
      p_recurring_rent: optNumber(b.recurring_rent),
      p_deposit: optNumber(b.deposit),
      p_charger_quantity: optNumber(b.charger_quantity),
      p_billable_extra_batteries: optNumber(b.billable_extra_batteries),
      p_notes: optionalString(b.notes),
      p_admin_tg_id: auth.telegramId,
      p_move_financial_history: Boolean(b.move_financial_history),
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
