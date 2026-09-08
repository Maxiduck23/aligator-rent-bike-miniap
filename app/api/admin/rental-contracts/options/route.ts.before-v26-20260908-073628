import { NextRequest } from "next/server";
import { fail, ok, requiredNumber } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const bikeId = requiredNumber(
      req.nextUrl.searchParams.get("bike_id"),
      "bike_id",
    );

    const [clientsResult, typesResult, batteriesResult, activeLinksResult] =
      await Promise.all([
        supabaseAdmin
          .from("clients")
          .select("id,name")
          .order("name", { ascending: true }),

        supabaseAdmin
          .from("battery_types")
          .select("id,brand,capacity,generation")
          .order("brand", { ascending: true }),

        supabaseAdmin
          .from("batteries")
          .select(
            "id,type_id,status,asset_status,bike_id,inventory_code,indexing_status,battery_types(brand,capacity,generation)",
          )
          .eq("asset_status", "active")
          .order("id", { ascending: true }),

        supabaseAdmin
          .from("battery_rentals")
          .select("battery_id")
          .eq("status", "active"),
      ]);

    if (clientsResult.error) throw clientsResult.error;
    if (typesResult.error) throw typesResult.error;
    if (batteriesResult.error) throw batteriesResult.error;
    if (activeLinksResult.error) throw activeLinksResult.error;

    const activeIds = new Set(
      (activeLinksResult.data || []).map((row: any) => Number(row.battery_id)),
    );

    const available = (batteriesResult.data || [])
      .filter((row: any) => !activeIds.has(Number(row.id)))
      .map((row: any) => {
        const type = Array.isArray(row.battery_types)
          ? row.battery_types[0]
          : row.battery_types;
        return {
          id: Number(row.id),
          type_id: Number(row.type_id),
          status: row.status,
          bike_id: row.bike_id,
          inventory_code: row.inventory_code,
          indexing_status: row.indexing_status,
          brand: type?.brand || null,
          capacity: type?.capacity || null,
          generation: type?.generation || null,
          preferred_for_bike: Number(row.bike_id) === bikeId,
        };
      })
      .sort((a: any, b: any) => {
        if (a.preferred_for_bike !== b.preferred_for_bike) {
          return a.preferred_for_bike ? -1 : 1;
        }
        return a.id - b.id;
      });

    return ok({
      clients: clientsResult.data || [],
      battery_types: typesResult.data || [],
      available_batteries: available,
    });
  } catch (e) {
    return fail(e);
  }
}
