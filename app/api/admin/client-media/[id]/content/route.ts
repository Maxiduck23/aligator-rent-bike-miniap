import { NextRequest } from 'next/server';
import { fail } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { downloadDriveFileV23 } from '@/lib/googleDriveV23';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireAdmin(req);
    const { id } = await ctx.params;
    const mediaId = Number(id);
    if (!Number.isFinite(mediaId)) throw new Error('Bad media_id');
    const thumb = new URL(req.url).searchParams.get('thumb') === '1';

    const { data: media, error } = await supabaseAdmin
      .from('client_media')
      .select('*')
      .eq('id', mediaId)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    if (media.provider !== 'google_drive') throw new Error(`Provider ${media.provider} пока не поддерживает proxy`);

    const fileId = thumb && media.thumbnail_storage_file_id
      ? media.thumbnail_storage_file_id
      : media.storage_file_id;
    const blob = await downloadDriveFileV23(String(fileId));

    await supabaseAdmin.from('client_media_access_log').insert({
      media_id: mediaId,
      client_id: media.client_id,
      actor_telegram_id: auth.telegramId,
      action: thumb ? 'view_thumbnail' : 'view_original',
      details: { media_type: media.media_type },
    });

    return new Response(blob.bytes, {
      status: 200,
      headers: {
        'Content-Type': thumb && media.thumbnail_storage_file_id ? 'image/webp' : (media.mime_type || blob.contentType),
        'Content-Length': String(blob.bytes.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
