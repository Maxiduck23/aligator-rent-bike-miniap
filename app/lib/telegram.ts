import crypto from 'crypto';
import { NextRequest } from 'next/server';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type AppRole = 'admin' | 'worker' | 'client';

export type AuthContext = {
  telegramId: number;
  user: TelegramUser | null;
  isAdmin: boolean;
  isWorker: boolean;
  role: AppRole;
};

function parseIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0)
  );
}

function adminIds(): Set<number> {
  return parseIds(process.env.ADMIN_IDS || '');
}

// v25: first worker account. WORKER_IDS can add more IDs without code changes.
// Admin always wins if an ID appears in both sets.
const BUILTIN_WORKER_IDS = new Set<number>([527159436]);

function workerIds(): Set<number> {
  const result = new Set<number>(BUILTIN_WORKER_IDS);
  for (const id of parseIds(process.env.WORKER_IDS || '')) result.add(id);
  return result;
}

function roleForTelegramId(telegramId: number): AppRole {
  if (adminIds().has(telegramId)) return 'admin';
  if (workerIds().has(telegramId)) return 'worker';
  return 'client';
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
    const role = roleForTelegramId(devTelegramId);
    return {
      telegramId: devTelegramId,
      user: { id: devTelegramId, first_name: role === 'worker' ? 'Dev Worker' : 'Dev Admin', username: 'dev' },
      isAdmin: role === 'admin',
      isWorker: role === 'worker',
      role,
    };
  }

  const initData = req.headers.get('x-telegram-init-data') || '';
  const { user } = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN || '');
  if (!user?.id) throw new Error('Telegram user is missing');

  const role = roleForTelegramId(user.id);
  return {
    telegramId: user.id,
    user,
    isAdmin: role === 'admin',
    isWorker: role === 'worker',
    role,
  };
}

export function requireAdmin(req: NextRequest): AuthContext {
  const auth = getAuthContext(req);
  if (!auth.isAdmin) throw new Error('Admin only');
  return auth;
}

export function requireStaff(req: NextRequest): AuthContext {
  const auth = getAuthContext(req);
  if (!auth.isAdmin && !auth.isWorker) throw new Error('Staff only');
  return auth;
}
