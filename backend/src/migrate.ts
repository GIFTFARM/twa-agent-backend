import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { client } from './db.js';

async function ensureMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

async function applied(): Promise<Set<string>> {
  const r = await client.query<{ name: string }>('SELECT name FROM _migrations');
  return new Set(r.rows.map((x) => x.name));
}

async function main() {
  const dir = new URL('./migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  await ensureMigrationsTable();
  const done = await applied();
  for (const f of files) {
    if (done.has(f)) {
      console.log(`  ✓ ${f} (already applied)`);
      continue;
    }
    const sql = await readFile(new URL(f, dir), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    console.log(`  → ${f} (${checksum.slice(0, 8)}…)`);
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]);
      console.log(`  ✓ ${f} applied`);
    } catch (e) {
      console.error(`  ✗ ${f} failed:`, e);
      throw e;
    }
  }
  await client.close();
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
