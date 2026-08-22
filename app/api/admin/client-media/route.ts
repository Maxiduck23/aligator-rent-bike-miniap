import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { deleteDriveFileV23, driveV23Configured, uploadDriveFileV23 } from '@/lib/googleDriveV23';

const ALLOWED_TYPES = new Set(['avatar','document','contract','other']);
const MAX_ORIGINAL = 12 * 1024 * 1024;
const MAX_THUMB = 700 * 1024;

function cleanName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const clientId = Number(new URL(req.url).searchParams.get('client_id'));
    if (!Number.isFinite(clientId)) throw new Error('client_id обязателен');
    const { data, error } = await supabaseAdmin
      .from('client_media')
      .select('id,client_id,media_type,provider,file_name,mime_type,size_bytes,sha256,is_current,is_sensitive,created_at,deleted_at,metadata')
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ok(data || []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdmin(req);
    if (!driveV23Configured()) throw new Error('Google Drive ещё не настроен: добавь 3 env-переменные из README v2.3');

    const form = await req.formData();
    const clientId = Number(form.get('client_id'));
    const mediaType = String(form.get('media_type') || 'avatar').trim().toLowerCase();
    const sensitive = String(form.get('is_sensitive') || '') === '1' || ['document','contract'].includes(mediaType);
    if (!Number.isFinite(clientId)) throw new Error('Некорректный client_id');
    if (!ALLOWED_TYPES.has(mediaType)) throw new Error('Некорректный media_type');

    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Файл не передан');
    if (file.size <= 0 || file.size > MAX_ORIGINAL) throw new Error('Файл должен быть от 1 байта до 12 MB');
    if (mediaType === 'avatar' && !file.type.startsWith('image/')) throw new Error('Фото клиента должно быть изображением');
    const thumbnail = form.get('thumbnail');
    if (thumbnail instanceof File && thumbnail.size > MAX_THUMB) throw new Error('Thumbnail больше 700 KB');

    const clientRes = await supabaseAdmin.from('clients').select('id,name').eq('id', clientId).single();
    if (clientRes.error) throw clientRes.error;

    const originalBytes = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(originalBytes).digest('hex');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const originalName = `client_${clientId}_${mediaType}_${stamp}_${cleanName(file.name || 'file')}`;
    const uploaded = await uploadDriveFileV23({
      name: originalName,
      mimeType: file.type || 'application/octet-stream',
      bytes: originalBytes,
    });

    let thumbnailId: string | null = null;
    try {
      if (thumbnail instanceof File && thumbnail.size > 0) {
        const thumbBytes = Buffer.from(await thumbnail.arrayBuffer());
        const thumb = await uploadDriveFileV23({
          name: `client_${clientId}_${mediaType}_${stamp}_thumb.webp`,
          mimeType: thumbnail.type || 'image/webp',
          bytes: thumbBytes,
        });
        thumbnailId = String(thumb.id);
      }

      const insert = await supabaseAdmin.rpc('miniapp_register_client_media_v23', {
        p_client_id: clientId,
        p_media_type: mediaType,
        p_provider: 'google_drive',
        p_storage_file_id: String(uploaded.id),
        p_thumbnail_storage_file_id: thumbnailId,
        p_file_name: file.name || originalName,
        p_mime_type: file.type || uploaded.mimeType || 'application/octet-stream',
        p_size_bytes: file.size,
        p_sha256: sha256,
        p_is_sensitive: sensitive,
        p_metadata: { google_name: uploaded.name, v23: true },
        p_admin_tg_id: auth.telegramId,
      });
      if (insert.error) throw insert.error;
      const mediaRow: any = insert.data;

      await supabaseAdmin.from('client_media_access_log').insert({
        media_id: mediaRow.id,
        client_id: clientId,
        actor_telegram_id: auth.telegramId,
        action: 'upload',
        details: { media_type: mediaType, size_bytes: file.size, has_thumbnail: Boolean(thumbnailId) },
      });
      return ok(mediaRow, 201);
    } catch (e) {
      // DB registration is transactional. If it fails after Drive upload, remove the
      // uploaded objects best-effort so a retry does not leave silent orphan files.
      try { if (thumbnailId) await deleteDriveFileV23(thumbnailId); } catch {}
      try { await deleteDriveFileV23(String(uploaded.id)); } catch {}
      console.error('v2.3 media DB stage failed; Drive cleanup attempted', { error: e });
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
