import { and, asc, eq } from "drizzle-orm";
import { decrypt, encrypt, randomToken } from "./crypto";
import { getDb, schema, type DB } from "./db";
import type { Provider } from "./db/schema";

const g = globalThis as unknown as { __adledgerSecret?: string };

/**
 * Secret used to encrypt stored credentials. Prefer APP_SECRET from the environment;
 * if absent, one is generated on first boot and kept in the database so installs
 * work with zero configuration.
 */
export async function getAppSecret(db?: DB): Promise<string> {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (g.__adledgerSecret) return g.__adledgerSecret;
  const d = db ?? (await getDb());
  await d
    .insert(schema.appMeta)
    .values({ key: "app_secret", value: randomToken(32) })
    .onConflictDoNothing();
  const [row] = await d.select().from(schema.appMeta).where(eq(schema.appMeta.key, "app_secret"));
  g.__adledgerSecret = row.value;
  return row.value;
}

export type Workspace = typeof schema.workspaces.$inferSelect;

/** v0.1 runs a single workspace per install (the schema is multi-tenant). */
export async function getWorkspace(db?: DB): Promise<Workspace | undefined> {
  const d = db ?? (await getDb());
  const [ws] = await d.select().from(schema.workspaces).orderBy(asc(schema.workspaces.createdAt)).limit(1);
  return ws;
}

export async function requireWorkspace(db?: DB): Promise<Workspace> {
  const ws = await getWorkspace(db);
  if (!ws) throw new Error("AdLedger is not set up yet. Open the dashboard to run setup.");
  return ws;
}

export type Connection = typeof schema.connections.$inferSelect & {
  secrets: Record<string, string>;
};

export async function getConnection(
  workspaceId: string,
  provider: Provider,
  db?: DB,
): Promise<Connection | undefined> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.workspaceId, workspaceId), eq(schema.connections.provider, provider)));
  if (!row) return undefined;
  const secret = await getAppSecret(d);
  const secrets = row.secretsEnc ? (JSON.parse(decrypt(row.secretsEnc, secret)) as Record<string, string>) : {};
  return { ...row, secrets };
}

export async function listConnections(workspaceId: string, db?: DB) {
  const d = db ?? (await getDb());
  return d.select().from(schema.connections).where(eq(schema.connections.workspaceId, workspaceId));
}

/**
 * Create or update a connection. Secret fields left empty keep their stored value,
 * so the settings form never has to echo secrets back to the browser.
 */
export async function saveConnection(
  workspaceId: string,
  provider: Provider,
  input: {
    mode?: "mock" | "live";
    enabled?: boolean;
    config?: Record<string, string>;
    secrets?: Record<string, string | undefined>;
  },
  db?: DB,
) {
  const d = db ?? (await getDb());
  const existing = await getConnection(workspaceId, provider, d);
  const secrets = { ...(existing?.secrets ?? {}) };
  for (const [k, v] of Object.entries(input.secrets ?? {})) {
    if (v !== undefined && v !== "") secrets[k] = v.trim();
  }
  const secretsEnc = Object.keys(secrets).length
    ? encrypt(JSON.stringify(secrets), await getAppSecret(d))
    : null;
  const values = {
    workspaceId,
    provider,
    mode: input.mode ?? existing?.mode ?? "live",
    enabled: input.enabled ?? existing?.enabled ?? true,
    config: { ...(existing?.config ?? {}), ...(input.config ?? {}) },
    secretsEnc,
    lastError: null,
  };
  await d
    .insert(schema.connections)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.connections.workspaceId, schema.connections.provider],
      set: values,
    });
  return getConnection(workspaceId, provider, d);
}

export async function deleteConnection(workspaceId: string, provider: Provider, db?: DB) {
  const d = db ?? (await getDb());
  await d
    .delete(schema.connections)
    .where(and(eq(schema.connections.workspaceId, workspaceId), eq(schema.connections.provider, provider)));
}

/** CONNECTOR_MODE=mock forces every connector to use fixture data (tests, demos, CI). */
export function forcedMockMode(): boolean {
  return process.env.CONNECTOR_MODE === "mock";
}

/** Returns the stored secret keys (never values) so the UI can show "configured". */
export function secretKeysOf(c: Connection | undefined): string[] {
  return c ? Object.keys(c.secrets) : [];
}
