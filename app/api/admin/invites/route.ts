import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { fail, ok, optionalNumber, optionalString } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function generateInviteKey(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < length; i++) key += alphabet[crypto.randomInt(alphabet.length)];
  return key;
}

function botUsername() {
  const raw = (process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || 'aligator_bike_bot').trim();
  return raw.replace(/^@+/, '');
}

function buildLinks(username: string, inviteKey: string) {
  const safeKey = encodeURIComponent(inviteKey);
  return {
    link: `https://t.me/${username}?start=${safeKey}`,
    tg_link: `tg://resolve?domain=${username}&start=${safeKey}`
  };
}

function isMissingIdError(error: any) {
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.code || ''}`.toLowerCase();
  return msg.includes('null value') && msg.includes('id');
}

async function nextInviteId() {
  const maxRes = await supabaseAdmin
    .from('contract_invites')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxRes.error) throw maxRes.error;
  return Number(maxRes.data?.id || 0) + 1;
}

async function insertInvite(payload: Record<string, any>) {
  // Сначала пробуем обычный insert. В нормальной DB id сам генерируется.
  const first = await supabaseAdmin
    .from('contract_invites')
    .insert(payload)
    .select('*')
    .single();

  if (!first.error) return first;

  // В старом export было видно, что contract_invites.id может быть без DEFAULT.
  // Тогда Supabase возвращает not-null ошибку по id. Даём id вручную.
  if (!isMissingIdError(first.error)) return first;

  const explicitId = await nextInviteId();
  return await supabaseAdmin
    .from('contract_invites')
    .insert({ id: explicitId, ...payload })
    .select('*')
    .single();
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const requestedKey = optionalString(body.invite_key)?.toUpperCase() || null;
    const clientId = optionalNumber(body.client_id);

    let lastError: any = null;
    let data: any = null;
    let inviteKey = requestedKey || generateInviteKey();

    for (let attempt = 0; attempt < 5; attempt++) {
      if (!requestedKey && attempt > 0) inviteKey = generateInviteKey();

      if (!/^[A-Z0-9_-]{4,64}$/.test(inviteKey)) {
        throw new Error('invite_key может содержать только A-Z, 0-9, _ и -');
      }

      const res = await insertInvite({
        invite_key: inviteKey,
        client_id: clientId,
        created_by_telegram_id: auth.telegramId,
        notes: optionalString(body.notes),
        status: 'active'
      });

      if (!res.error) {
        data = res.data;
        lastError = null;
        break;
      }

      lastError = res.error;
      if (requestedKey || res.error.code !== '23505') break;
    }

    if (lastError) throw lastError;
    if (!data) throw new Error('Не получилось создать ключ');

    const username = botUsername();
    if (!username || username === 'YOUR_BOT_USERNAME') throw new Error('TELEGRAM_BOT_USERNAME не настроен в Vercel');

    return ok({ ...data, invite_key: inviteKey, bot_username: username, ...buildLinks(username, inviteKey) }, 201);
  } catch (e) {
    return fail(e);
  }
}
