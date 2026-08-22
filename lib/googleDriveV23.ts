import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function env() {
  return {
    // Preferred for a normal/personal Google Drive account: OAuth refresh token.
    clientId: String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim(),
    refreshToken: String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim(),
    // Optional alternative for Workspace / Shared Drive deployments.
    serviceEmail: String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    servicePrivateKey: String(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
    folderId: String(process.env.GOOGLE_DRIVE_CLIENT_MEDIA_FOLDER_ID || '').trim(),
  };
}

export function driveV23Configured() {
  const e = env();
  const oauth = Boolean(e.clientId && e.clientSecret && e.refreshToken);
  const serviceAccount = Boolean(e.serviceEmail && e.servicePrivateKey);
  return Boolean(e.folderId && (oauth || serviceAccount));
}

export function driveV23AuthMode() {
  const e = env();
  if (e.clientId && e.clientSecret && e.refreshToken) return 'oauth_refresh_token';
  if (e.serviceEmail && e.servicePrivateKey) return 'service_account';
  return 'none';
}

let cachedToken: { token: string; expiresAt: number; mode: string } | null = null;

async function oauthRefreshAccessToken() {
  const e = env();
  const body = new URLSearchParams({
    client_id: e.clientId,
    client_secret: e.clientSecret,
    refresh_token: e.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google OAuth refresh error: ${json.error_description || json.error || res.status}`);
  }
  return { token: String(json.access_token), expiresIn: Number(json.expires_in || 3600) };
}

async function serviceAccountAccessToken() {
  const { serviceEmail, servicePrivateKey } = env();
  if (!serviceEmail || !servicePrivateKey) throw new Error('Google Drive service account не настроен');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: serviceEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), servicePrivateKey);
  const assertion = `${input}.${b64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Google service-account OAuth error: ${json.error_description || json.error || res.status}`);
  }
  return { token: String(json.access_token), expiresIn: Number(json.expires_in || 3600) };
}

async function accessToken() {
  const mode = driveV23AuthMode();
  if (mode === 'none') throw new Error('Google Drive не настроен на сервере');
  if (cachedToken && cachedToken.mode === mode && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const result = mode === 'oauth_refresh_token'
    ? await oauthRefreshAccessToken()
    : await serviceAccountAccessToken();
  cachedToken = {
    token: result.token,
    expiresAt: Date.now() + result.expiresIn * 1000,
    mode,
  };
  return result.token;
}

export async function uploadDriveFileV23(args: {
  name: string;
  mimeType: string;
  bytes: Buffer;
  folderId?: string;
}) {
  const token = await accessToken();
  const { folderId: defaultFolder } = env();
  const folderId = args.folderId || defaultFolder;
  if (!folderId) throw new Error('GOOGLE_DRIVE_CLIENT_MEDIA_FOLDER_ID не задан');

  const boundary = `aligator_v23_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = Buffer.from(JSON.stringify({ name: args.name, parents: [folderId] }));
  const before = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`);
  const middle = Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${args.mimeType || 'application/octet-stream'}\r\n\r\n`);
  const after = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([before, metadata, middle, args.bytes, after]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    },
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) throw new Error(`Google Drive upload error: ${json.error?.message || res.status}`);
  return json;
}

export async function downloadDriveFileV23(fileId: string) {
  const token = await accessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Drive download error: ${res.status} ${text.slice(0, 180)}`);
  }
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function deleteDriveFileV23(fileId: string) {
  const token = await accessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Drive delete error: ${res.status} ${text.slice(0, 180)}`);
  }
}
