import { NextRequest } from "next/server";
import { fail, ok, optionalNumber, optionalString, requiredNumber } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function requiredString(value: unknown, field: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${field} is required`);
  return s;
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const assetType = optionalString(body.asset_type) || "bike";
    const action = optionalString(body.action) || "purchase";
    const date = optionalString(body.date) || new Date().toISOString().slice(0, 10);
    const notes = optionalString(body.notes);

    if (assetType === "bike" && action === "purchase") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_bike_purchase", {
        p_bike_id: requiredNumber(body.bike_id, "bike_id"),
        p_brand: requiredString(body.brand, "brand"),
        p_model: requiredString(body.model, "model"),
        p_vin: optionalString(body.vin),
        p_amount: requiredNumber(body.amount, "amount"),
        p_purchase_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "bike" && action === "sale") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_bike_sale", {
        p_bike_id: requiredNumber(body.bike_id, "bike_id"),
        p_amount: requiredNumber(body.amount, "amount"),
        p_sale_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "battery" && action === "purchase") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_battery_purchase", {
        p_battery_id: optionalNumber(body.battery_id),
        p_type_id: requiredNumber(body.type_id, "type_id"),
        p_bike_id: optionalNumber(body.bike_id),
        p_amount: requiredNumber(body.amount, "amount"),
        p_purchase_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "battery" && action === "sale") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_battery_sale", {
        p_battery_id: requiredNumber(body.battery_id, "battery_id"),
        p_amount: requiredNumber(body.amount, "amount"),
        p_sale_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
      });
      if (error) throw error;
      return ok(data);
    }

    throw new Error("Unsupported asset action");
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const { data, error } = await supabaseAdmin
      .from('asset_transactions')
      .select('*')
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok({ recent: data || [] });
  } catch (e) {
    return fail(e);
  }
}
