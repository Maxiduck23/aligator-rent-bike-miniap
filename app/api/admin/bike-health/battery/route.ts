import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function parseBatteryIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  return String(value || '')
    .split(/[\s,;]+/)
    .map((x) => Number(x.trim().replace('#', '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await req.json();
    const bikeId = requiredNumber(body.bike_id, 'bike_id');
    const batteryIds = parseBatteryIds(body.battery_ids);
    const healthStatus = optionalString(body.health_status) || 'unknown';
    const notes = optionalString(body.notes);
    if (!batteryIds.length) throw new Error('Укажи ID батарей, например: 1,2');

    const { data, error } = await supabaseAdmin
      .from('batteries')
      .update({
        bike_id: bikeId,
        status: 'rented',
        first_used_at: new Date().toISOString(),
        health_status: healthStatus,
        health_notes: notes,
        last_checked_at: new Date().toISOString(),
      })
      .in('id', batteryIds)
      .select('id, bike_id, status, health_status');
    if (error) throw error;

    return ok({ bike_id: bikeId, updated: data || [], requested_battery_ids: batteryIds });
  } catch (e) {
    return fail(e);
  }
}
