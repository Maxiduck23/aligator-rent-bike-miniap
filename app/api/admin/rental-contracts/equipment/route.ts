import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const rentalId = requiredNumber(new URL(req.url).searchParams.get('rental_id'), 'rental_id');
    const { data, error } = await supabaseAdmin
      .from('battery_rentals')
      .select('id,rental_id,battery_id,status,created_at,returned_at,notes,batteries(id,inventory_code,indexing_status,type_id,status,notes)')
      .eq('rental_id', rentalId)
      .eq('status', 'active')
      .order('id');
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const b = await req.json();
    const { data, error } = await supabaseAdmin.rpc('miniapp_remove_contract_battery', {
      p_rental_id: requiredNumber(b.rental_id, 'rental_id'),
      p_battery_id: requiredNumber(b.battery_id, 'battery_id'),
      p_admin_tg_id: auth.telegramId,
      p_notes: optionalString(b.notes),
    });
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
