import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

function parseInitData(initData: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of initData.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

export async function validateTelegramInitData(initData: string): Promise<TelegramUser> {
  if (!initData) throw new Error('empty');
  const parsed = parseInitData(initData);
  const hash = parsed.hash;
  if (!hash) throw new Error('no hash');

  const dataCheckString = Object.keys(parsed)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${parsed[k]}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheckString).digest();

  const a = Buffer.from(computed);
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad signature');

  const user: TelegramUser = JSON.parse(parsed.user ?? '{}');
  if (!user.id) throw new Error('no user');
  return user;
}

export function isAdmin(userId: number): boolean {
  return userId === config.adminTelegramId;
}
