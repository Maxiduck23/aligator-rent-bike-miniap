import { NextRequest } from "next/server";
import {
  fail,
  ok,
  optionalNumber,
  optionalString,
  requiredNumber,
} from "@/lib/http";
import { requireStaff } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function requiredString(value: unknown, field: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${field} is required`);
  return s;
}

function assertAssetAction(assetType: string, action: string) {
  if (!["bike", "battery"].includes(assetType)) {
    throw new Error("asset_type должен быть bike или battery");
  }
  if (!["purchase", "sale"].includes(action)) {
    throw new Error("action должен быть purchase или sale");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const body = await req.json();
    const assetType = optionalString(body.asset_type) || "bike";
    const action = optionalString(body.action) || "purchase";
    const date = optionalString(body.date) || new Date().toISOString().slice(0, 10);
    const notes = optionalString(body.notes);
    const requestKey = optionalString(body.request_key);

    assertAssetAction(assetType, action);

    if (auth.isWorker && assetType !== "bike") {
      throw new Error("Worker can record only bike purchase/sale");
    }

    if (assetType === "bike" && action === "purchase") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_bike_purchase_v27", {
        p_bike_id: optionalNumber(body.bike_id),
        p_brand: requiredString(body.brand, "brand"),
        p_model: requiredString(body.model, "model"),
        p_vin: optionalString(body.vin),
        p_amount: requiredNumber(body.amount, "amount"),
        p_purchase_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
        p_request_key: requestKey,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "bike" && action === "sale") {
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_bike_sale_v27", {
        p_bike_id: requiredNumber(body.bike_id, "bike_id"),
        p_amount: requiredNumber(body.amount, "amount"),
        p_sale_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
        p_request_key: requestKey,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "battery" && action === "purchase") {
      if (auth.isWorker) throw new Error("Admin only");
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_battery_purchase_v27", {
        p_battery_id: optionalNumber(body.battery_id),
        p_type_id: requiredNumber(body.type_id, "type_id"),
        p_bike_id: optionalNumber(body.bike_id),
        p_amount: requiredNumber(body.amount, "amount"),
        p_purchase_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
        p_request_key: requestKey,
      });
      if (error) throw error;
      return ok(data);
    }

    if (assetType === "battery" && action === "sale") {
      if (auth.isWorker) throw new Error("Admin only");
      const { data, error } = await supabaseAdmin.rpc("miniapp_asset_battery_sale_v27", {
        p_battery_id: requiredNumber(body.battery_id, "battery_id"),
        p_amount: requiredNumber(body.amount, "amount"),
        p_sale_date: date,
        p_notes: notes,
        p_admin_tg_id: auth.telegramId,
        p_request_key: requestKey,
      });
      if (error) throw error;
      return ok(data);
    }

    throw new Error("Unsupported asset action");
  } catch (e) {
    return fail(e);
  }
}

async function nextIds() {
  const [bikeRes, batteryRes] = await Promise.all([
    supabaseAdmin.from("bikes").select("id").order("id", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("batteries").select("id").order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (bikeRes.error) throw bikeRes.error;
  if (batteryRes.error) throw batteryRes.error;
  return {
    next_bike_id: Number(bikeRes.data?.id || 0) + 1,
    next_battery_id: Number(batteryRes.data?.id || 0) + 1,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = requireStaff(req);
    const ids = await nextIds();

    if (auth.isWorker) {
      return ok({ recent: [], history_hidden: true, ...ids });
    }

    const { data, error } = await supabaseAdmin
      .from("asset_transactions")
      .select("*")
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ok({ recent: data || [], ...ids });
  } catch (e) {
    return fail(e);
  }
}
