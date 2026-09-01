import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { client } from './db.js';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

export async function runMigrations() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (${NOW})
    )
  `);
  const dir = new URL('./migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const r = await client.query<{ name: string }>('SELECT name FROM _migrations');
  const done = new Set(r.rows.map((x) => x.name));
  for (const f of files) {
    if (done.has(f)) {
      console.log(`[migrate] ✓ ${f} (already applied)`);
      continue;
    }
    const sql = await readFile(new URL(f, dir), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    console.log(`[migrate] → ${f} (${checksum.slice(0, 8)}…)`);
    await client.query(sql);
    await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]);
    console.log(`[migrate] ✓ ${f} applied`);
  }
}
