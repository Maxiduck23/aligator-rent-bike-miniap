import { NextRequest } from "next/server";
import { fail, ok, optionalString, requiredNumber } from "@/lib/http";
import { requireStaff } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();

    const { data, error } = await supabaseAdmin.rpc(
      "miniapp_transfer_rental_bike_v28",
      {
        p_rental_id: requiredNumber(body.rental_id, "rental_id"),
        p_new_bike_id: requiredNumber(body.new_bike_id, "new_bike_id"),
        p_keep_current_batteries: body.keep_current_batteries !== false,
        p_admin_tg_id: auth.telegramId,
        p_notes: optionalString(body.notes),
      },
    );

    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
