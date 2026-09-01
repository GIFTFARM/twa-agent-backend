import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional('PORT', '3000')),
  webappUrl: optional('WEBAPP_URL', 'http://localhost:5173'),
  botToken: required('TELEGRAM_BOT_TOKEN'),
  adminTelegramId: Number(optional('ADMIN_TELEGRAM_ID', '0')),
  databaseUrl: optional('DATABASE_URL', 'sqlite:./data.db'),
  encryptionKey: required('ENCRYPTION_KEY'),
  publicUrl: optional('PUBLIC_URL', ''), // used by self-ping; set to Render URL after deploy
  disableSelfPing: optional('DISABLE_SELF_PING', '') === '1',
};

if (config.adminTelegramId < 0 || !Number.isFinite(config.adminTelegramId)) {
  throw new Error('ADMIN_TELEGRAM_ID must be a non-negative integer (0 = no admin)');
}
if (config.encryptionKey.length < 32) {
  throw new Error('ENCRYPTION_KEY must be >= 32 chars (use base64 of 32 random bytes)');
}
