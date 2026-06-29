import crypto from 'crypto';
import { NextRequest } from 'next/server';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type AuthContext = {
  telegramId: number;
  user: TelegramUser | null;
  isAdmin: boolean;
};

function adminIds(): Set<number> {
  return new Set(
    (process.env.ADMIN_IDS || '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0)
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function validateTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 86400): { user: TelegramUser | null } {
  if (!initData) throw new Error('No Telegram initData');
  if (!botToken) throw new Error('No TELEGRAM_BOT_TOKEN');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('No hash in initData');

  params.delete('hash');

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) throw new Error('No auth_date in initData');
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) throw new Error('Bad auth_date');

  const now = Math.floor(Date.now() / 1000);
  if (maxAgeSeconds > 0 && now - authDate > maxAgeSeconds) {
    throw new Error('Telegram initData expired');
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(calculatedHash, hash)) {
    throw new Error('Bad Telegram initData hash');
  }

  const rawUser = params.get('user');
  const user = rawUser ? (JSON.parse(rawUser) as TelegramUser) : null;
  return { user };
}

export function getAuthContext(req: NextRequest): AuthContext {
  const devMode = process.env.AUTH_DEV_MODE === '1';
  const devTelegramId = Number(process.env.DEV_TELEGRAM_ID || '0');

  if (devMode && devTelegramId > 0) {
    return {
      telegramId: devTelegramId,
      user: { id: devTelegramId, first_name: 'Dev Admin', username: 'dev' },
      isAdmin: adminIds().has(devTelegramId)
    };
  }

  const initData = req.headers.get('x-telegram-init-data') || '';
  const { user } = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN || '');
  if (!user?.id) throw new Error('Telegram user is missing');

  return {
    telegramId: user.id,
    user,
    isAdmin: adminIds().has(user.id)
  };
}

export function requireAdmin(req: NextRequest): AuthContext {
  const auth = getAuthContext(req);
  if (!auth.isAdmin) throw new Error('Admin only');
  return auth;
}
