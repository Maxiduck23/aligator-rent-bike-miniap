import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ALLOWED_STATUS = new Set(['new','in_progress','approved','rejected','closed','cancelled']);
const ALLOWED_PRIORITY = new Set(['low','normal','high','urgent']);
const TYPE_TO_CHARGE: Record<string, string | null> = {
  repair_request: 'repair',
  battery_request: 'battery',
  accessory_request: 'parts',
  payment_request: 'manual',
  contract_request: 'manual',
  other_request: 'manual',
  rent_request: null,
  replace_request: null,
  return_request: null,
};

async function enrich(rows: any[]) {
  const clientIds = [...new Set(rows.map((r) => Number(r.client_id)).filter(Boolean))];
  const bikeIds = [...new Set(rows.map((r) => Number(r.bike_id)).filter(Boolean))];
  const [clientsRes, bikesRes] = await Promise.all([
    clientIds.length ? supabaseAdmin.from('clients').select('id,name,phone,telegram_id').in('id', clientIds) : Promise.resolve({ data: [], error: null } as any),
    bikeIds.length ? supabaseAdmin.from('bikes').select('id,brand,model,status').in('id', bikeIds) : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  if (bikesRes.error) throw bikesRes.error;
  const clients = new Map((clientsRes.data || []).map((x: any) => [Number(x.id), x]));
  const bikes = new Map((bikesRes.data || []).map((x: any) => [Number(x.id), x]));
  return rows.map((r) => ({ ...r, client: clients.get(Number(r.client_id)) || null, bike: bikes.get(Number(r.bike_id)) || null }));
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'open';
    const type = url.searchParams.get('type') || 'all';
    let query = supabaseAdmin.from('client_requests').select('*').order('created_at', { ascending: false }).limit(300);
    if (status === 'open') query = query.in('status', ['new','in_progress']);
    else if (status !== 'all') query = query.eq('status', status);
    if (type !== 'all') query = query.eq('request_type', type);
    const { data, error } = await query;
    if (error) throw error;
    return ok(await enrich(data || []));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json();
    const requestId = Number(body.request_id);
    if (!Number.isFinite(requestId) || requestId <= 0) throw new Error('request_id обязателен');
    const action = String(body.action || 'update');

    const { data: current, error: currentError } = await supabaseAdmin.from('client_requests').select('*').eq('id', requestId).single();
    if (currentError) throw currentError;

    if (action === 'create_charge') {
      if (current.resolved_charge_id) throw new Error(`Начисление уже создано: #${current.resolved_charge_id}`);
      const amount = Number(body.amount ?? current.quoted_amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Укажи цену/сумму больше 0');
      const chargeType = TYPE_TO_CHARGE[current.request_type];
      if (!chargeType) throw new Error('Для этой категории сначала используй профильный процесс (например создание договора/возврат), а не ручное начисление');
      const dueDate = String(body.due_date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(new Date()));
      const { data: charge, error } = await supabaseAdmin.from('client_charges').insert({
        client_id: current.client_id,
        rental_id: current.rental_id || null,
        bike_id: current.bike_id || null,
        charge_type: chargeType,
        amount,
        paid_amount: 0,
        due_date: dueDate,
        status: 'due',
        notes: `[client_request #${current.id}] ${current.title || current.request_type}${current.request_subtype ? ` / ${current.request_subtype}` : ''}`,
        remind_client: true,
        remind_admin: true,
      }).select('*').single();
      if (error) throw error;
      const { data: updated, error: updateError } = await supabaseAdmin.from('client_requests').update({
        resolved_charge_id: charge.id,
        quoted_amount: amount,
        status: 'approved',
        decided_by_telegram_id: auth.telegramId,
        assigned_admin_telegram_id: auth.telegramId,
        updated_at: new Date().toISOString(),
      }).eq('id', requestId).select('*').single();
      if (updateError) throw updateError;
      return ok({ request: updated, charge }, 201);
    }

    const patch: any = { updated_at: new Date().toISOString(), decided_by_telegram_id: auth.telegramId };
    if (body.status !== undefined) {
      const status = String(body.status);
      if (!ALLOWED_STATUS.has(status)) throw new Error('Некорректный статус');
      patch.status = status;
      if (['approved','rejected','closed','cancelled'].includes(status)) patch.closed_at = new Date().toISOString();
    }
    if (body.request_type !== undefined) patch.request_type = String(body.request_type);
    if (body.request_subtype !== undefined) patch.request_subtype = body.request_subtype ? String(body.request_subtype) : null;
    if (body.priority !== undefined) {
      const priority = String(body.priority);
      if (!ALLOWED_PRIORITY.has(priority)) throw new Error('Некорректный приоритет');
      patch.priority = priority;
    }
    if (body.bike_id !== undefined) patch.bike_id = body.bike_id ? Number(body.bike_id) : null;
    if (body.rental_id !== undefined) patch.rental_id = body.rental_id ? Number(body.rental_id) : null;
    if (body.quoted_amount !== undefined) patch.quoted_amount = body.quoted_amount === '' || body.quoted_amount === null ? null : Number(body.quoted_amount);
    if (body.admin_note !== undefined) patch.admin_note = body.admin_note ? String(body.admin_note) : null;
    if (body.assign_to_me) patch.assigned_admin_telegram_id = auth.telegramId;

    const { data, error } = await supabaseAdmin.from('client_requests').update(patch).eq('id', requestId).select('*').single();
    if (error) throw error;
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
