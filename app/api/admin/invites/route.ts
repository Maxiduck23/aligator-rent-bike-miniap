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

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const inviteKey = optionalString(body.invite_key) || generateInviteKey();
    const clientId = optionalNumber(body.client_id);

    const { data, error } = await supabaseAdmin
      .from('contract_invites')
      .insert({
        invite_key: inviteKey,
        client_id: clientId,
        created_by_telegram_id: auth.telegramId,
        notes: optionalString(body.notes),
        status: 'active'
      })
      .select('*')
      .single();
    if (error) throw error;

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YOUR_BOT_USERNAME';
    return ok({ ...data, link: `https://t.me/${botUsername}?start=${inviteKey}` }, 201);
  } catch (e) {
    return fail(e);
  }
}
