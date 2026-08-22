import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/http';
import { requireAdmin } from '@/lib/telegram';
import { driveV23AuthMode, driveV23Configured } from '@/lib/googleDriveV23';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    return ok({ configured: driveV23Configured(), provider: 'google_drive', auth_mode: driveV23AuthMode() });
  } catch (e) {
    return fail(e);
  }
}
