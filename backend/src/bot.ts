import { Bot, Context } from 'grammy';
import { config } from './config.js';
import { chat } from './llm.js';
import { query } from './db.js';

const PRICES: Record<string, { stars: number; tier: string; days: number }> = {
  pro_month: { stars: 250, tier: 'pro', days: 30 },
  pro_year: { stars: 2500, tier: 'pro', days: 365 },
  team_month: { stars: 750, tier: 'team', days: 30 },
};

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const NOW_PLUS_DAYS = (days: string | number) => `datetime(${NOW}, '+${days} days')`;

export const bot = new Bot<Context>(config.botToken);

bot.catch((err) => console.error('bot error:', err));

bot.on('pre_checkout_query', async (ctx) => {
  const payload = (ctx.preCheckoutQuery as any).payload as string;
  const [userId, sku] = payload.split(':');
  if (!PRICES[sku]) return ctx.answerPreCheckoutQuery(false, 'Неизвестный тариф');
  // upsert: SQLite uses INSERT OR IGNORE
  await query(
    `INSERT INTO subscriptions(user_id, tier, stars_paid, invoice_payload, is_active)
     VALUES ($1, $2, 0, $3, 0)
     ON CONFLICT (invoice_payload) DO NOTHING`,
    [Number(userId), PRICES[sku].tier, payload],
  );
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('message:successful_payment', async (ctx) => {
  const p = ctx.message.successful_payment;
  const payload = p.invoice_payload;
  const [_userId, sku] = payload.split(':');
  const plan = PRICES[sku];
  if (!plan) return;
  const total = p.total_amount;
  await query(
    `UPDATE subscriptions
        SET stars_paid = $1, started_at = ${NOW}, expires_at = ${NOW_PLUS_DAYS(plan.days)}, is_active = 1
      WHERE invoice_payload = $2`,
    [total, payload],
  );
  await ctx.reply(`✅ Спасибо! Тариф *${plan.tier.toUpperCase()}* активирован на ${plan.days} дней.`, { parse_mode: 'Markdown' });
});

bot.command('start', async (ctx) => {
  const u = ctx.from;
  if (!u) return;
  await upsertUser(u);
  await ctx.reply(
    `👋 Привет, ${u.first_name ?? 'друг'}!\n\n` +
      `Я — AI-агент. Нажми кнопку ниже, чтобы открыть чат.`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Открыть чат', web_app: { url: config.webappUrl } },
        ]],
      },
    },
  );
});

bot.command('admin', async (ctx) => {
  if (ctx.from?.id !== config.adminTelegramId) return ctx.reply('⛔ Нет доступа');
  await ctx.reply('🛠 Админ-панель:', {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Открыть', web_app: { url: `${config.webappUrl}/admin` } },
      ]],
    },
  });
});

bot.command('devices', async (ctx) => {
  if (!ctx.from) return;
  const r = await query<{ name: string | null; model: string | null; online: number | boolean }>(
    `SELECT name, model, online FROM devices WHERE user_id = $1`,
    [ctx.from.id],
  );
  if (r.rows.length === 0) return ctx.reply('📱 Устройств нет. Установите Android-агент.');
  const lines = r.rows.map((d) =>
    `• ${d.name ?? 'без имени'} (${d.model ?? '?'}) — ${d.online ? '🟢 online' : '⚪ offline'}`,
  );
  await ctx.reply('📱 Ваши устройства:\n\n' + lines.join('\n'));
});

bot.on('message:text', async (ctx) => {
  const u = ctx.from;
  if (!u) return;
  await upsertUser(u);
  const text = ctx.message.text;
  await ctx.replyWithChatAction('typing');

  const history = await loadHistory(u.id, 20);
  history.push({ role: 'user', content: text });

  try {
    const { text: reply, provider, model, tokensIn, tokensOut } = await chat(u.id, history);
    await ctx.reply(reply, { parse_mode: 'Markdown' }).catch(() => ctx.reply(reply));
    await query(
      `INSERT INTO conversations(user_id, role, content, provider, model, tokens_in, tokens_out)
       VALUES ($1, 'user', $2, NULL, NULL, NULL, NULL),
              ($1, 'assistant', $3, $4, $5, $6, $7)`,
      [u.id, text, reply, provider, model, tokensIn ?? null, tokensOut ?? null],
    );
  } catch (e) {
    console.error('chat failed', e);
    await ctx.reply('⚠️ Ошибка модели: ' + (e as Error).message);
  }
});

async function loadHistory(userId: number, n: number) {
  const r = await query<{ role: string; content: string }>(
    `SELECT role, content FROM (
        SELECT role, content, created_at FROM conversations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2
     ) sub ORDER BY created_at ASC`,
    [userId, n],
  );
  return r.rows.map((x) => ({ role: x.role as 'user' | 'assistant', content: x.content }));
}

async function upsertUser(u: NonNullable<Context['from']>) {
  const isAdmin = u.id === config.adminTelegramId ? 1 : 0;
  await query(
    `INSERT INTO users(id, username, first_name, language_code, is_admin, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, ${NOW})
     ON CONFLICT (id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       language_code = excluded.language_code,
       is_admin = CASE WHEN excluded.is_admin = 1 THEN 1 ELSE users.is_admin END,
       last_seen_at = ${NOW}`,
    [u.id, u.username ?? null, u.first_name ?? null, u.language_code ?? null, isAdmin],
  );
}
