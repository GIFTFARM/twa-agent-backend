import { Router } from 'express';
import { query } from '../db.js';
import { encryptString, decryptString, maskKey } from '../crypto.js';
import { validateTelegramInitData, isAdmin } from '../telegram-auth.js';

export const adminRouter = Router();

async function requireAdmin(initData: string) {
  const u = await validateTelegramInitData(initData);
  if (!isAdmin(u.id)) throw new Error('forbidden');
  return u;
}

function parseModels(raw: unknown): Array<{ id: string; name?: string; free?: boolean }> {
  if (Array.isArray(raw)) return raw as any;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

adminRouter.get('/providers', async (req, res) => {
  try {
    await requireAdmin(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(403).json({ error: 'admin only' });
  }
  const r = await query<{
    id: number;
    name: string;
    base_url: string;
    api_key_enc: Buffer;
    models: string | Array<{ id: string; name?: string; free?: boolean }>;
    is_default: number | boolean;
    enabled: number | boolean;
  }>(
    `SELECT id, name, base_url, api_key_enc, models, is_default, enabled
       FROM providers ORDER BY id`,
  );
  res.json({
    providers: r.rows.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.base_url,
      apiKeyMasked: maskKey(decryptString(p.api_key_enc)),
      models: parseModels(p.models),
      isDefault: Boolean(p.is_default),
      enabled: Boolean(p.enabled),
    })),
  });
});

adminRouter.post('/providers', async (req, res) => {
  let user;
  try {
    user = await requireAdmin(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(403).json({ error: 'admin only' });
  }
  const { name, baseUrl, apiKey, models, isDefault, enabled } = req.body ?? {};
  if (!name || !baseUrl || !apiKey) return res.status(400).json({ error: 'name, baseUrl, apiKey required' });

  const enc = encryptString(String(apiKey));
  const modelsJson = JSON.stringify(Array.isArray(models) ? models : []);
  const r = await query<{ id: number }>(
    `INSERT INTO providers(name, base_url, api_key_enc, models, is_default, enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      String(name),
      String(baseUrl),
      enc,
      modelsJson,
      Boolean(isDefault) ? 1 : 0,
      enabled !== false ? 1 : 0,
      user.id,
    ],
  );
  res.json({ id: r.rows[0]?.id });
});

adminRouter.put('/providers/:id', async (req, res) => {
  try {
    await requireAdmin(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(403).json({ error: 'admin only' });
  }
  const id = Number(req.params.id);
  const { name, baseUrl, apiKey, models, isDefault, enabled } = req.body ?? {};

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(String(name)); }
  if (baseUrl !== undefined) { sets.push(`base_url = $${i++}`); vals.push(String(baseUrl)); }
  if (apiKey !== undefined) { sets.push(`api_key_enc = $${i++}`); vals.push(encryptString(String(apiKey))); }
  if (models !== undefined) { sets.push(`models = $${i++}`); vals.push(JSON.stringify(models)); }
  if (isDefault !== undefined) { sets.push(`is_default = $${i++}`); vals.push(Boolean(isDefault) ? 1 : 0); }
  if (enabled !== undefined) { sets.push(`enabled = $${i++}`); vals.push(Boolean(enabled) ? 1 : 0); }
  sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
  vals.push(id);

  if (isDefault) {
    await query(`UPDATE providers SET is_default = 0 WHERE id <> $1`, [id]);
  }
  await query(`UPDATE providers SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  res.json({ ok: true });
});

adminRouter.delete('/providers/:id', async (req, res) => {
  try {
    await requireAdmin(String(req.headers['x-tg-init-data'] ?? ''));
  } catch {
    return res.status(403).json({ error: 'admin only' });
  }
  await query(`DELETE FROM providers WHERE id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

adminRouter.post('/providers/:id/test', async (_req, res) => {
  res.json({ ok: true });
});
