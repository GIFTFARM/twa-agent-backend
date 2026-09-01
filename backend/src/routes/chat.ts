import { Router } from 'express';
import { chat } from '../llm.js';
import { query } from '../db.js';
import { validateTelegramInitData } from '../telegram-auth.js';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export const chatRouter = Router();

chatRouter.post('/chat', async (req, res) => {
  const initData = String(req.headers['x-tg-init-data'] ?? '');
  const user = await validateTelegramInitData(initData).catch(() => null);
  if (!user) return res.status(401).json({ error: 'invalid initData' });

  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'empty message' });

  await query(
    `INSERT INTO users(id, first_name, username, last_seen_at) VALUES ($1,$2,$3,${NOW})
     ON CONFLICT (id) DO UPDATE SET last_seen_at = ${NOW}`,
    [user.id, user.first_name ?? null, user.username ?? null],
  );

  const r = await query<{ role: string; content: string }>(
    `SELECT role, content FROM (
        SELECT role, content, created_at FROM conversations
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20
     ) sub ORDER BY created_at ASC`,
    [user.id],
  );
  const history = r.rows.map((x) => ({ role: x.role as 'user' | 'assistant', content: x.content }));
  history.push({ role: 'user', content: message });

  try {
    const result = await chat(user.id, history);
    await query(
      `INSERT INTO conversations(user_id, role, content, provider, model, tokens_in, tokens_out)
       VALUES ($1,'user',$2,NULL,NULL,NULL,NULL), ($1,'assistant',$3,$4,$5,$6,$7)`,
      [user.id, message, result.text, result.provider, result.model, result.tokensIn ?? null, result.tokensOut ?? null],
    );
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

chatRouter.get('/history', async (req, res) => {
  const initData = String(req.headers['x-tg-init-data'] ?? '');
  const user = await validateTelegramInitData(initData).catch(() => null);
  if (!user) return res.status(401).json({ error: 'invalid initData' });

  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const r = await query<{ id: number; role: string; content: string; created_at: string }>(
    `SELECT id, role, content, created_at FROM conversations
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [user.id, limit],
  );
  res.json({ messages: r.rows.reverse() });
});
