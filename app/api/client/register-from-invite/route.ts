import { NextRequest } from 'next/server';
import { fail, ok, optionalString, requiredString } from '@/lib/http';
import { getAuthContext } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthContext(req);
    const body = await req.json().catch(() => ({}));
    const inviteKey = requiredString(body.invite_key, 'invite_key').trim().toUpperCase();
    const name = optionalString(body.name);
    const phone = optionalString(body.phone);
    const email = optionalString(body.email);
    const address = optionalString(body.address);
    const docType = optionalString(body.doc_type);
    const docNumber = optionalString(body.doc_number);
    const notes = optionalString(body.notes);

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('contract_invites')
      .select('*')
      .eq('invite_key', inviteKey)
      .eq('status', 'active')
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invite) throw new Error('Ключ не найден, уже использован или истёк.');
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      throw new Error('Ключ истёк. Попроси администратора создать новый.');
    }

    let clientId = invite.client_id ? Number(invite.client_id) : null;
    let client: any = null;

    if (clientId) {
      const updatePayload: Record<string, any> = {
        telegram_id: auth.telegramId,
        tg_registered_at: new Date().toISOString(),
      };
      if (name) updatePayload.name = name;
      if (phone) updatePayload.phone = phone;
      if (email) updatePayload.email = email;
      if (address) updatePayload.address = address;
      if (docType) updatePayload.doc_type = docType;
      if (docNumber) updatePayload.doc_number = docNumber;
      if (notes) updatePayload.notes = notes;

      const res = await supabaseAdmin
        .from('clients')
        .update(updatePayload)
        .eq('id', clientId)
        .select('*')
        .single();
      if (res.error) throw res.error;
      client = res.data;
    } else {
      if (!name) throw new Error('Имя обязательно для создания нового клиента.');
      const res = await supabaseAdmin
        .from('clients')
        .insert({
          name,
          phone,
          email,
          address,
          doc_type: docType || 'ID card',
          doc_number: docNumber,
          telegram_id: auth.telegramId,
          notes,
          payment_status: 'ok',
          tg_registered_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (res.error) throw res.error;
      client = res.data;
      clientId = Number(client.id);
    }

    const { data: existingUser } = await supabaseAdmin
      .from('telegram_users')
      .select('role')
      .eq('telegram_id', auth.telegramId)
      .maybeSingle();

    const role = existingUser?.role === 'admin' ? 'admin' : 'client';
    const userRes = await supabaseAdmin
      .from('telegram_users')
      .upsert({
        telegram_id: auth.telegramId,
        username: auth.user?.username || null,
        role,
        client_id: clientId,
        has_private_chat: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'telegram_id' });
    if (userRes.error) throw userRes.error;

    const usedRes = await supabaseAdmin
      .from('contract_invites')
      .update({
        status: 'used',
        used_by_telegram_id: auth.telegramId,
        used_at: new Date().toISOString(),
        client_id: clientId,
      })
      .eq('invite_key', inviteKey);
    if (usedRes.error) throw usedRes.error;

    return ok({ client, client_id: clientId, linked: true });
  } catch (e) {
    return fail(e);
  }
}
