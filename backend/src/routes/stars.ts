import { Router } from 'express';
import { bot } from '../bot.js';
import { query } from '../db.js';
import { validateTelegramInitData } from '../telegram-auth.js';

export const starsRouter = Router();

const PRICES: Record<string, { stars: number; tier: string; days: number }> = {
  pro_month: { stars: 250, tier: 'pro', days: 30 },
  pro_year: { stars: 2500, tier: 'pro', days: 365 },
  team_month: { stars: 750, tier: 'team', days: 30 },
};

starsRouter.post('/invoice', async (req, res) => {
  let user;
  try {
    user = await validateTelegramInitData(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(401).json({ error: 'invalid initData' });
  }
  const sku = String(req.body?.sku ?? '');
  const plan = PRICES[sku];
  if (!plan) return res.status(400).json({ error: 'unknown sku' });

  const payload = `${user.id}:${sku}:${Date.now()}`;

  // Send invoice via bot to user's chat
  await bot.api.sendInvoice(
    user.id,
    `TWA Agent — ${plan.tier.toUpperCase()}`,
    `${plan.days} дней премиум-доступа`,
    payload,
    'XTR',
    [{ label: plan.tier, amount: plan.stars }],
    { provider_token: '' } as any,
  );

  res.json({ payload, sku, stars: plan.stars });
});

starsRouter.post('/webhook', async (req, res) => {
  // Telegram posts update objects here. Same format as bot.handleUpdate.
  // We don't actually need a separate webhook if we use long polling,
  // but this is here for completeness when deployed with a public URL.
  await bot.handleUpdate(req.body);
  res.json({ ok: true });
});
