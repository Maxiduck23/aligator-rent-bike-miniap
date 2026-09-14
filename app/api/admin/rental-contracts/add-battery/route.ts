import { NextRequest } from "next/server";
import { fail, ok, requiredNumber } from "@/lib/http";
import { requireStaff } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validateBatterySlot } from "@/lib/rentalContracts";

// Compatibility endpoint.
//
// v28 rule:
// * worker can NEVER change contract price through this endpoint;
// * default behavior for both roles is physical attach only;
// * old billable extra-battery logic is available to ADMIN only when
//   billing_mode === "billable" is explicitly sent.
export async function POST(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();
    const battery = validateBatterySlot(body.battery);
    const rentalId = requiredNumber(body.rental_id, "rental_id");

    const wantsBillable =
      String(body.billing_mode || "").toLowerCase() === "billable";

    if (wantsBillable) {
      if (!auth.isAdmin) {
        throw new Error(
          "Работник может менять физические батареи, но не создавать/менять денежные условия.",
        );
      }

      const { data, error } = await supabaseAdmin.rpc(
        "miniapp_add_contract_battery",
        {
          p_rental_id: rentalId,
          p_battery: battery,
          p_effective_date:
            body.effective_date || new Date().toISOString().slice(0, 10),
          p_charge_now: body.charge_now !== false,
          p_admin_tg_id: auth.telegramId,
        },
      );
      if (error) throw error;
      return ok({ ...data, financial_change: true }, 201);
    }

    const { data, error } = await supabaseAdmin.rpc(
      "miniapp_attach_contract_battery_physical_v28",
      {
        p_rental_id: rentalId,
        p_battery: battery,
        p_admin_tg_id: auth.telegramId,
        p_notes: auth.isWorker
          ? "worker physical battery attach v28"
          : "admin physical battery attach v28",
      },
    );

    if (error) throw error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
