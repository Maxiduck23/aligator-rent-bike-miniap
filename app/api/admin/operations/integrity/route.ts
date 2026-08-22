import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredNumber } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const [integrityRes, legacyRes] = await Promise.all([
      supabaseAdmin
        .from('miniapp_finance_integrity_v221')
        .select('*')
        .order('severity', { ascending: true })
        .order('entity_id', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('miniapp_legacy_allocation_candidates_v221')
        .select('payment_id', { count: 'exact', head: true }),
    ]);
    if (integrityRes.error) throw integrityRes.error;
    if (legacyRes.error) throw legacyRes.error;

    const rows = integrityRes.data || [];
    return ok({
      rows,
      total: rows.length,
      critical: rows.filter((r: any) => r.severity === 'critical').length,
      warning: rows.filter((r: any) => r.severity === 'warning').length,
      repairable: rows.filter((r: any) => r.repair_action === 'recalculate_charge').length,
      legacy_candidates: Number(legacyRes.count || 0),
      by_type: rows.reduce((acc: Record<string, number>, r: any) => {
        acc[r.issue_type || 'unknown'] = (acc[r.issue_type || 'unknown'] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const action = optionalString(body.action) || '';

    if (action === 'recalculate_charge') {
      const chargeId = requiredNumber(body.charge_id, 'charge_id');
      const { data, error } = await supabaseAdmin.rpc('miniapp_recalculate_charge_from_allocations_v221', {
        p_charge_id: chargeId,
        p_admin_tg_id: auth.telegramId,
        p_reason: 'Mini App v2.2.1 R2 Finance Integrity',
      });
      if (error) throw error;
      return ok(data);
    }

    if (action === 'preview_legacy_backfill' || action === 'apply_legacy_backfill') {
      const dryRun = action === 'preview_legacy_backfill';
      const { data, error } = await supabaseAdmin.rpc('miniapp_backfill_legacy_direct_allocations_v221', {
        p_dry_run: dryRun,
        p_admin_tg_id: auth.telegramId,
      });
      if (error) throw error;
      return ok(data);
    }

    throw new Error('unsupported action');
  } catch (e) {
    return fail(e);
  }
}
