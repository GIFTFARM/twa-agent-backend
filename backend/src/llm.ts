import OpenAI from 'openai';
import { query } from './db.js';
import { decryptString, maskKey } from './crypto.js';

export interface ModelEntry {
  id: string;
  name?: string;
  free?: boolean;
}

export interface ProviderRow {
  id: number;
  name: string;
  base_url: string;
  api_key_enc: Buffer;
  models: ModelEntry[] | string;
  is_default: number | boolean;
  enabled: number | boolean;
}

export interface ResolvedProvider {
  id: number;
  name: string;
  baseURL: string;
  apiKey: string;
  client: OpenAI;
}

function parseModels(raw: unknown): ModelEntry[] {
  if (Array.isArray(raw)) return raw as ModelEntry[];
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

export async function listProvidersForAdmin() {
  const r = await query<{
    id: number;
    name: string;
    base_url: string;
    models: string | ModelEntry[];
    is_default: number | boolean;
    enabled: number | boolean;
    api_key_enc: Buffer;
  }>(
    `SELECT id, name, base_url, api_key_enc, models, is_default, enabled
       FROM providers ORDER BY id`,
  );
  return r.rows.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.base_url,
    models: parseModels(p.models),
    isDefault: Boolean(p.is_default),
    enabled: Boolean(p.enabled),
    apiKeyMasked: maskKey(decryptString(p.api_key_enc)),
  }));
}

export async function resolveProviderForUser(userId: number): Promise<ResolvedProvider> {
  const r = await query<ProviderRow & { model: string | null }>(
    `SELECT p.*, up.model
       FROM user_prefs up
       JOIN providers p ON p.id = up.provider_id
      WHERE up.user_id = $1 AND p.enabled = 1
      LIMIT 1`,
    [userId],
  );
  if (r.rows[0]) return toResolved(r.rows[0]);

  const def = await query<ProviderRow>(
    `SELECT * FROM providers WHERE is_default = 1 AND enabled = 1 LIMIT 1`,
  );
  if (def.rows[0]) return toResolved(def.rows[0]);

  const any = await query<ProviderRow>(
    `SELECT * FROM providers WHERE enabled = 1 ORDER BY id LIMIT 1`,
  );
  if (any.rows[0]) return toResolved(any.rows[0]);

  throw new Error('No LLM provider configured. Ask admin to add one in /admin');
}

function toResolved(p: ProviderRow): ResolvedProvider {
  const apiKey = decryptString(p.api_key_enc);
  return {
    id: p.id,
    name: p.name,
    baseURL: p.base_url,
    apiKey,
    client: new OpenAI({ apiKey, baseURL: p.base_url }),
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(
  userId: number,
  history: ChatMessage[],
): Promise<{ text: string; provider: string; model: string; tokensIn?: number; tokensOut?: number }> {
  const prov = await resolveProviderForUser(userId);
  const pref = await query<{ model: string | null; system_prompt: string | null }>(
    `SELECT model, system_prompt FROM user_prefs WHERE user_id = $1`,
    [userId],
  );
  const provRow = await query<{ models: string | ModelEntry[] }>(
    `SELECT models FROM providers WHERE id = $1`,
    [prov.id],
  );
  const modelsList = parseModels(provRow.rows[0]?.models);
  const defaultModel = modelsList[0]?.id ?? 'gpt-4o-mini';
  const model = pref.rows[0]?.model || defaultModel;
  const sys = pref.rows[0]?.system_prompt || 'You are a helpful assistant. Reply concisely.';

  const messages: ChatMessage[] = [{ role: 'system', content: sys }, ...history];

  const resp = await prov.client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
  });

  const text = resp.choices[0]?.message?.content ?? '';
  return {
    text,
    provider: prov.name,
    model,
    tokensIn: resp.usage?.prompt_tokens,
    tokensOut: resp.usage?.completion_tokens,
  };
}
