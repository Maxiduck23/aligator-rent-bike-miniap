import { NextRequest } from "next/server";
import { fail, ok, optionalString } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const chargeIds = Array.isArray(body.charge_ids)
      ? body.charge_ids.map(Number).filter(Number.isFinite)
      : [];
    if (!chargeIds.length) throw new Error("charge_ids is required");

    const createPayment = Boolean(body.create_payment);

    const { data, error } = await supabaseAdmin.rpc(
      "miniapp_close_plan_charges",
      {
        p_charge_ids: chargeIds,
        p_create_payment: createPayment,
        p_payment_date: optionalString(body.payment_date),
        p_method: optionalString(body.method) || (createPayment ? "manual_plan_close" : "plan_only"),
        p_note: optionalString(body.note) || (createPayment ? "manual planned rent close with payment" : "manual planned rent close without payment"),
        p_admin_tg_id: auth.telegramId,
      },
    );
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
