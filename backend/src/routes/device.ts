import { Router } from 'express';
import { query } from '../db.js';
import { validateTelegramInitData } from '../telegram-auth.js';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export const deviceRouter = Router();

deviceRouter.get('/list', async (req, res) => {
  let user;
  try {
    user = await validateTelegramInitData(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(401).json({ error: 'invalid initData' });
  }
  const r = await query<{ id: number; name: string | null; model: string | null; online: number; last_seen_at: string | null }>(
    `SELECT id, name, model, online, last_seen_at FROM devices WHERE user_id = $1`,
    [user.id],
  );
  res.json({ devices: r.rows });
});

deviceRouter.post('/command', async (req, res) => {
  let user;
  try {
    user = await validateTelegramInitData(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(401).json({ error: 'invalid initData' });
  }
  const { deviceId, kind, payload } = req.body ?? {};
  if (!deviceId || !kind) return res.status(400).json({ error: 'deviceId, kind required' });

  const r = await query<{ id: number }>(
    `INSERT INTO device_commands(device_id, user_id, kind, payload)
     SELECT id, $1, $2, $3 FROM devices WHERE user_id = $1 AND id = $4 RETURNING id`,
    [user.id, String(kind), JSON.stringify(payload ?? {}), Number(deviceId)],
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'device not found' });
  res.json({ id: r.rows[0].id });
});

deviceRouter.get('/command/:id', async (req, res) => {
  let user;
  try {
    user = await validateTelegramInitData(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(401).json({ error: 'invalid initData' });
  }
  const r = await query<{ id: number; status: string; result: string | null }>(
    `SELECT id, status, result FROM device_commands
      WHERE id = $1 AND user_id = $2`,
    [Number(req.params.id), user.id],
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

// --- From Android agent (no Telegram initData; uses deviceId+telegramUserId in body) ---

deviceRouter.post('/register', async (req, res) => {
  const { deviceId, name, model, androidVersion, permissions, fcmToken } = req.body ?? {};
  const telegramUserId = Number(req.body?.telegramUserId);
  if (!deviceId || !telegramUserId) return res.status(400).json({ error: 'deviceId, telegramUserId required' });

  await query(
    `INSERT INTO users(id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [telegramUserId],
  );

  await query(
    `INSERT INTO devices(user_id, device_id, name, model, android_version, permissions, fcm_token, online, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, 1, ${NOW})
     ON CONFLICT (user_id, device_id) DO UPDATE SET
       name = excluded.name,
       model = excluded.model,
       android_version = excluded.android_version,
       permissions = excluded.permissions,
       fcm_token = COALESCE(excluded.fcm_token, devices.fcm_token),
       online = 1,
       last_seen_at = ${NOW}`,
    [telegramUserId, String(deviceId), name ?? null, model ?? null, androidVersion ?? null,
     JSON.stringify(permissions ?? []), fcmToken ?? null],
  );
  res.json({ ok: true });
});

deviceRouter.post('/heartbeat', async (req, res) => {
  const { deviceId, telegramUserId } = req.body ?? {};
  if (!deviceId || !telegramUserId) return res.status(400).json({ error: 'deviceId, telegramUserId required' });
  await query(
    `UPDATE devices SET online = 1, last_seen_at = ${NOW}
      WHERE user_id = $1 AND device_id = $2`,
    [Number(telegramUserId), String(deviceId)],
  );
  res.json({ ok: true });
});

deviceRouter.post('/pull', async (req, res) => {
  const { deviceId, telegramUserId } = req.body ?? {};
  if (!deviceId || !telegramUserId) return res.status(400).json({ error: 'deviceId, telegramUserId required' });
  const r = await query<{ id: number; kind: string; payload: string | null }>(
    `UPDATE device_commands
        SET status = 'in_progress'
      WHERE id IN (
        SELECT id FROM device_commands dc
          JOIN devices d ON d.id = dc.device_id
         WHERE d.user_id = $1 AND d.device_id = $2 AND dc.status = 'pending'
         ORDER BY dc.created_at LIMIT 1
      )
      RETURNING id, kind, payload`,
    [Number(telegramUserId), String(deviceId)],
  );
  res.json({ command: r.rows[0] ?? null });
});

deviceRouter.post('/result', async (req, res) => {
  const { id, status, result } = req.body ?? {};
  if (!id) return res.status(400).json({ error: 'id required' });
  await query(
    `UPDATE device_commands
        SET status = $1, result = $2, completed_at = ${NOW}
      WHERE id = $3`,
    [String(status ?? 'done'), JSON.stringify(result ?? {}), Number(id)],
  );
  res.json({ ok: true });
});
