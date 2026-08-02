import { NextRequest } from 'next/server';
import { fail, ok, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateBatterySlot } from '@/lib/rentalContracts';

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const battery = validateBatterySlot(body.battery);

    const { data, error } = await supabaseAdmin.rpc('miniapp_add_contract_battery', {
      p_rental_id: requiredNumber(body.rental_id, 'rental_id'),
      p_battery: battery,
      p_effective_date: body.effective_date || new Date().toISOString().slice(0, 10),
      p_charge_now: body.charge_now !== false,
      p_admin_tg_id: auth.telegramId,
    });

    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
