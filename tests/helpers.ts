import { randomBytes } from "node:crypto";
import { getDb, schema } from "@/lib/db";

/**
 * Fresh database per test file (vitest isolates modules per file).
 * Default: in-memory embedded Postgres. With TEST_DATABASE_URL set (CI), each test file
 * gets its own throwaway database on a real PostgreSQL server.
 */
async function freshDatabase() {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin || process.env.DATABASE_URL?.startsWith("postgres")) return;
  const { Client } = await import("pg");
  const name = `adledger_t_${randomBytes(5).toString("hex")}`;
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`create database ${name}`);
  await c.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
}

export async function setupWorkspace(overrides: Partial<typeof schema.workspaces.$inferInsert> = {}) {
  await freshDatabase();
  const db = await getDb();
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: "Test", slug: `test-${Math.random().toString(36).slice(2, 8)}`, reportingCurrency: "USD", timezone: "UTC", ...overrides })
    .returning();
  return { db, ws };
}
