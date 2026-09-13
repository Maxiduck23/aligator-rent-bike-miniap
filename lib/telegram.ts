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

  // Effective role for this request.
  isAdmin: boolean;
  isWorker: boolean;
  role: AppRole;

  // Real role before optional test downgrade.
  realRole: AppRole;
  isRoleOverride: boolean;
  canTestWorker: boolean;
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

const BUILTIN_WORKER_IDS = new Set<number>([527159436]);

function workerIds(): Set<number> {
  const result = new Set<number>(BUILTIN_WORKER_IDS);
  for (const id of parseIds(process.env.WORKER_IDS || '')) result.add(id);
  return result;
}

// v27: only these REAL admins may downgrade their own effective role to worker.
// This cannot grant admin access to anyone.
const BUILTIN_ROLE_TESTER_IDS = new Set<number>([812040832]);

function roleTesterIds(): Set<number> {
  const result = new Set<number>(BUILTIN_ROLE_TESTER_IDS);
  for (const id of parseIds(process.env.ROLE_TESTER_IDS || '')) result.add(id);
  return result;
}

function realRoleForTelegramId(telegramId: number): AppRole {
  if (adminIds().has(telegramId)) return 'admin';
  if (workerIds().has(telegramId)) return 'worker';
  return 'client';
}

function effectiveRoleForRequest(
  req: NextRequest,
  telegramId: number,
  realRole: AppRole
): { role: AppRole; isOverride: boolean; canTestWorker: boolean } {
  const canTestWorker = realRole === 'admin' && roleTesterIds().has(telegramId);
  const requested = (req.headers.get('x-test-role') || '').trim().toLowerCase();

  if (canTestWorker && requested === 'worker') {
    return { role: 'worker', isOverride: true, canTestWorker: true };
  }

  return { role: realRole, isOverride: false, canTestWorker };
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

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): { user: TelegramUser | null } {
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
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (!timingSafeEqualHex(calculatedHash, hash)) {
    throw new Error('Bad Telegram initData hash');
  }

  const rawUser = params.get('user');
  const user = rawUser ? (JSON.parse(rawUser) as TelegramUser) : null;
  return { user };
}

function buildAuth(
  req: NextRequest,
  telegramId: number,
  user: TelegramUser | null
): AuthContext {
  const realRole = realRoleForTelegramId(telegramId);
  const effective = effectiveRoleForRequest(req, telegramId, realRole);

  return {
    telegramId,
    user,
    isAdmin: effective.role === 'admin',
    isWorker: effective.role === 'worker',
    role: effective.role,
    realRole,
    isRoleOverride: effective.isOverride,
    canTestWorker: effective.canTestWorker,
  };
}

export function getAuthContext(req: NextRequest): AuthContext {
  const devMode = process.env.AUTH_DEV_MODE === '1';
  const devTelegramId = Number(process.env.DEV_TELEGRAM_ID || '0');

  if (devMode && devTelegramId > 0) {
    const realRole = realRoleForTelegramId(devTelegramId);
    const user: TelegramUser = {
      id: devTelegramId,
      first_name:
        realRole === 'worker'
          ? 'Dev Worker'
          : realRole === 'admin'
            ? 'Dev Admin'
            : 'Dev Client',
      username: 'dev',
    };
    return buildAuth(req, devTelegramId, user);
  }

  const initData = req.headers.get('x-telegram-init-data') || '';
  const { user } = validateTelegramInitData(
    initData,
    process.env.TELEGRAM_BOT_TOKEN || ''
  );
  if (!user?.id) throw new Error('Telegram user is missing');

  return buildAuth(req, user.id, user);
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
