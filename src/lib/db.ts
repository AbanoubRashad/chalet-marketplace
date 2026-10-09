import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";
import { blobSyncEnabled, pullIfChanged, push } from "./blob-sync";

export type DB = DatabaseSync;
export type Param = SQLInputValue;
export type Row = Record<string, unknown>;

const globalForDb = globalThis as unknown as { __clinicDb?: DatabaseSync; __clinicDbBoot?: (db: DB) => void };

/** Hook run once after the shared connection opens (used to seed the demo tenant in dev). */
export function onDbBoot(fn: (db: DB) => void) {
  globalForDb.__clinicDbBoot = fn;
}

export function getDb(): DB {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "market.db");
  if (blobSyncEnabled()) {
    if (!globalForDb.__clinicDb) {
      pullIfChanged(file, true);
      globalForDb.__clinicDb = openDb(file);
      globalForDb.__clinicDbBoot?.(globalForDb.__clinicDb);
    } else if (!(depth.get(globalForDb.__clinicDb) ?? 0) && pullIfChanged(file)) {
      // another instance wrote: reopen on the fresh copy
      try {
        globalForDb.__clinicDb.close();
      } catch {
        /* ignore */
      }
      globalForDb.__clinicDb = openDb(file);
    }
    return globalForDb.__clinicDb;
  }
  if (!globalForDb.__clinicDb) {
    globalForDb.__clinicDb = openDb(file);
    globalForDb.__clinicDb && globalForDb.__clinicDbBoot?.(globalForDb.__clinicDb);
  }
  return globalForDb.__clinicDb;
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  files.set(db, file);
  db.exec("PRAGMA busy_timeout = 15000;");
  // With Blob mirroring the file must be self-contained after each commit, so no WAL there.
  if (file !== ":memory:") db.exec(blobSyncEnabled() ? "PRAGMA journal_mode = DELETE;" : "PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const m of MIGRATIONS) {
    transaction(db, () => {
      const done = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(m.version);
      if (done) return;
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, new Date().toISOString());
    });
  }
}

const depth = new WeakMap<DB, number>();
const files = new WeakMap<DB, string>();
const totalChanges = (db: DB) => Number((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n);

/** Mirror the shared demo DB after a committed write (no-op unless Blob sync is enabled). */
function afterWrite(db: DB) {
  const f = files.get(db);
  if (f && blobSyncEnabled() && f === process.env.DATABASE_PATH) push(f);
}

/**
 * Runs fn inside a write transaction (BEGIN IMMEDIATE takes the write lock up front,
 * so concurrent writers queue instead of interleaving). Nested calls use savepoints.
 */
export function transaction<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp_${d}`;
  const before = d === 0 ? totalChanges(db) : 0;
  db.exec(d === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const result = fn();
    db.exec(d === 0 ? "COMMIT" : `RELEASE ${sp}`);
    if (d === 0 && totalChanges(db) > before) {
      depth.set(db, 0);
      afterWrite(db);
    }
    return result;
  } catch (err) {
    try {
      db.exec(d === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    } catch {
      /* already rolled back */
    }
    throw err;
  } finally {
    depth.set(db, d);
  }
}

export function all<T = Row>(db: DB, sql: string, ...params: Param[] | [Record<string, Param>]): T[] {
  return db.prepare(sql).all(...(params as Param[])) as T[];
}

export function get<T = Row>(db: DB, sql: string, ...params: Param[] | [Record<string, Param>]): T | undefined {
  return db.prepare(sql).get(...(params as Param[])) as T | undefined;
}

export function run(db: DB, sql: string, ...params: Param[] | [Record<string, Param>]) {
  const r = db.prepare(sql).run(...(params as Param[]));
  if (Number(r.changes) > 0 && !(depth.get(db) ?? 0)) afterWrite(db);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function nowIso(d: Date = new Date()) {
  return d.toISOString();
}
