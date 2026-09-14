import { NextRequest } from "next/server";
import { fail, ok, optionalString, requiredNumber } from "@/lib/http";
import { requireStaff } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validateBatterySlot } from "@/lib/rentalContracts";

export async function GET(req: NextRequest) {
  try {
    requireStaff(req);
    const rentalId = requiredNumber(
      new URL(req.url).searchParams.get("rental_id"),
      "rental_id",
    );

    const { data, error } = await supabaseAdmin
      .from("battery_rentals")
      .select(
        "id,rental_id,battery_id,status,created_at,returned_at,notes,batteries(id,inventory_code,indexing_status,type_id,status,bike_id,notes)",
      )
      .eq("rental_id", rentalId)
      .eq("status", "active")
      .order("id");

    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

// Admin + worker: PHYSICAL battery operations only.
// No price/payment_rule/client_charge/client_payment changes.
export async function POST(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();
    const action = String(body.action || "attach").trim().toLowerCase();
    const rentalId = requiredNumber(body.rental_id, "rental_id");
    const notes = optionalString(body.notes);

    if (action === "attach") {
      const battery = validateBatterySlot(body.battery);
      const { data, error } = await supabaseAdmin.rpc(
        "miniapp_attach_contract_battery_physical_v28",
        {
          p_rental_id: rentalId,
          p_battery: battery,
          p_admin_tg_id: auth.telegramId,
          p_notes: notes,
        },
      );
      if (error) throw error;
      return ok(data, 201);
    }

    if (action === "replace") {
      const battery = validateBatterySlot(body.battery);
      const { data, error } = await supabaseAdmin.rpc(
        "miniapp_replace_contract_battery_physical_v28",
        {
          p_rental_id: rentalId,
          p_old_battery_id: requiredNumber(
            body.old_battery_id,
            "old_battery_id",
          ),
          p_new_battery: battery,
          p_admin_tg_id: auth.telegramId,
          p_notes: notes,
        },
      );
      if (error) throw error;
      return ok(data);
    }

    if (action === "repair") {
      const { data, error } = await supabaseAdmin.rpc(
        "miniapp_repair_contract_battery_links_v28",
        {
          p_rental_id: rentalId,
          p_admin_tg_id: auth.telegramId,
        },
      );
      if (error) throw error;
      return ok(data);
    }

    throw new Error("action должен быть attach, replace или repair");
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();

    const { data, error } = await supabaseAdmin.rpc(
      "miniapp_remove_contract_battery_physical_v28",
      {
        p_rental_id: requiredNumber(body.rental_id, "rental_id"),
        p_battery_id: requiredNumber(body.battery_id, "battery_id"),
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
