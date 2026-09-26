import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

type State = { db: DB; ready: Promise<void>; close: () => Promise<void> };
const g = globalThis as unknown as { __adledgerDb?: State };

/**
 * DATABASE_URL=postgres://...  -> PostgreSQL via node-postgres (production)
 * DATABASE_URL=memory://       -> in-memory embedded Postgres (tests)
 * DATABASE_URL unset           -> embedded Postgres (PGlite) persisted in ./.data (zero-setup dev)
 */
async function open(): Promise<State> {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (url.startsWith("postgres")) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    const db = drizzle(pool, { schema }) as unknown as DB;
    return {
      db,
      ready: migrate(drizzle(pool, { schema }), { migrationsFolder: MIGRATIONS }),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir =
    url === "memory://" ? undefined : path.resolve(process.env.DATA_DIR ?? ".data", "pglite");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const raw = drizzle(client, { schema });
  return {
    db: raw as unknown as DB,
    ready: migrate(raw, { migrationsFolder: MIGRATIONS }),
    close: () => client.close(),
  };
}

let opening: Promise<State> | undefined;

/** Returns a migrated database handle (migrations run once per process). */
export async function getDb(): Promise<DB> {
  if (!g.__adledgerDb) {
    opening ??= open();
    const state = await opening;
    g.__adledgerDb = state;
  }
  await g.__adledgerDb.ready;
  return g.__adledgerDb.db;
}

export async function closeDb() {
  const s = g.__adledgerDb;
  g.__adledgerDb = undefined;
  opening = undefined;
  if (s) await s.close();
}

/** Embedded PGlite is single-connection and single-process. */
export function isEmbeddedDb(): boolean {
  return !(process.env.DATABASE_URL ?? "").trim().startsWith("postgres");
}

/** `db.execute` returns `{ rows }` on both drivers. */
export function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
