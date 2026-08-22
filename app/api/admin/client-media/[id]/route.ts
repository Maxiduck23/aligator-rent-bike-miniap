import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { deleteDriveFileV23, driveV23Configured } from '@/lib/googleDriveV23';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireAdmin(req);
    const { id } = await ctx.params;
    const mediaId = Number(id);
    if (!Number.isFinite(mediaId)) throw new Error('Bad media_id');

    const { data: media, error } = await supabaseAdmin.from('client_media').select('*').eq('id', mediaId).is('deleted_at', null).single();
    if (error) throw error;

    const upd = await supabaseAdmin.from('client_media').update({ is_current: false, deleted_at: new Date().toISOString() }).eq('id', mediaId);
    if (upd.error) throw upd.error;

    let driveDeleted = false;
    let driveError: string | null = null;
    if (media.provider === 'google_drive' && driveV23Configured()) {
      try {
        if (media.thumbnail_storage_file_id) await deleteDriveFileV23(String(media.thumbnail_storage_file_id));
        await deleteDriveFileV23(String(media.storage_file_id));
        driveDeleted = true;
      } catch (e: any) {
        driveError = e?.message || String(e);
      }
    }

    await supabaseAdmin.from('client_media_access_log').insert({
      media_id: mediaId,
      client_id: media.client_id,
      actor_telegram_id: auth.telegramId,
      action: 'delete',
      details: { drive_deleted: driveDeleted, drive_error: driveError },
    });

    return ok({ id: mediaId, deleted: true, drive_deleted: driveDeleted, drive_error: driveError });
  } catch (e) {
    return fail(e);
  }
}
