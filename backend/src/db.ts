import { config } from './config.js';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface QueryClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
  raw: unknown;
}

const isPg = /^postgres(ql)?:/.test(config.databaseUrl);

/** Convert PostgreSQL `$1, $2, ...` placeholders to SQLite `?`. Naive but safe for our queries. */
function pgToSqlite(sql: string): string {
  return sql.replace(/\$\d+/g, '?');
}

async function makePg(): Promise<QueryClient> {
  const pg = await import('pg');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const client: QueryClient = {
    raw: pool,
    async query<T>(text: string, params: unknown[] = []) {
      const r = await pool.query(text, params as never);
      return { rows: r.rows as unknown as T[], rowCount: r.rowCount ?? r.rows.length };
    },
    async close() { await pool.end(); },
  };
  return client;
}

async function makeSqlite(): Promise<QueryClient> {
  const Database = (await import('better-sqlite3')).default;
  const path = config.databaseUrl.replace(/^sqlite:/, '') || 'data.db';
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const client: QueryClient = {
    raw: db,
    async query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const sql = pgToSqlite(text);
      const head = sql.trim().split(/\s+/, 1)[0].toUpperCase();
      // Convert JSONB / BLOB casts: not used in our SQL (we removed them)
      if (head === 'SELECT' || head === 'WITH' || head === 'PRAGMA' || head === 'EXPLAIN') {
        const stmt = db.prepare(sql);
        const rows = params.length ? stmt.all(...(params as any[])) : stmt.all();
        return { rows: rows as unknown as T[], rowCount: (rows as unknown[]).length };
      }
      const stmt = db.prepare(sql);
      const info = params.length ? stmt.run(...(params as any[])) : stmt.run();
      return { rows: [], rowCount: info.changes };
    },
    async close() { db.close(); },
  };
  return client;
}

export const client: QueryClient = isPg ? await makePg() : await makeSqlite();
export async function query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return client.query<T>(text, params);
}
