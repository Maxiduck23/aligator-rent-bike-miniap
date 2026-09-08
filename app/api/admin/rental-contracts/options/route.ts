import { NextRequest } from "next/server";
import { fail, ok, requiredNumber } from "@/lib/http";
import { requireStaff } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    requireStaff(req);
    const bikeId = requiredNumber(req.nextUrl.searchParams.get("bike_id"), "bike_id");
    const [clientsResult, typesResult, batteriesResult, activeLinksResult] = await Promise.all([
      supabaseAdmin.from("clients").select("id,name").order("name", { ascending: true }),
      supabaseAdmin.from("battery_types").select("id,brand,capacity,generation").order("brand", { ascending: true }),
      supabaseAdmin.from("batteries").select("id,type_id,status,asset_status,bike_id,inventory_code,indexing_status,battery_types(brand,capacity,generation)").eq("asset_status", "active").order("id", { ascending: true }),
      supabaseAdmin.from("battery_rentals").select("battery_id").eq("status", "active"),
    ]);
    for (const r of [clientsResult,typesResult,batteriesResult,activeLinksResult]) if (r.error) throw r.error;
    const activeIds = new Set((activeLinksResult.data || []).map((x: any) => Number(x.battery_id)));
    const available = (batteriesResult.data || []).filter((x: any) => !activeIds.has(Number(x.id))).map((x: any) => {
      const t = Array.isArray(x.battery_types) ? x.battery_types[0] : x.battery_types;
      return { id:Number(x.id), type_id:Number(x.type_id), status:x.status, bike_id:x.bike_id, inventory_code:x.inventory_code, indexing_status:x.indexing_status, brand:t?.brand||null, capacity:t?.capacity||null, generation:t?.generation||null, preferred_for_bike:Number(x.bike_id)===bikeId };
    }).sort((a:any,b:any)=>a.preferred_for_bike!==b.preferred_for_bike?(a.preferred_for_bike?-1:1):a.id-b.id);
    return ok({ clients: clientsResult.data || [], battery_types: typesResult.data || [], available_batteries: available });
  } catch (e) { return fail(e); }
}
