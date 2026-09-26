import { and, count, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { getDb, schema, type DB } from "./db";
import type { Workspace } from "./settings";

export const SESSION_COOKIE = "al_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; email: string; name: string | null; workspace: Workspace };

export async function hasUsers(db?: DB): Promise<boolean> {
  const d = db ?? (await getDb());
  const [r] = await d.select({ n: count() }).from(schema.users);
  return (r?.n ?? 0) > 0;
}

async function isHttps(): Promise<boolean> {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  const h = await headers();
  return (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

export async function startSession(userId: string, workspaceId: string) {
  const db = await getDb();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

async function userFromSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: schema.users, workspace: schema.workspaces })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!row) return null;
  return { id: row.user.id, email: row.user.email, name: row.user.name, workspace: row.workspace };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For pages: signed-in user, or redirect to /setup (fresh install) or /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user) return user;
  redirect((await hasUsers()) ? "/login" : "/setup");
}

// ---- login throttling (in-memory; the app runs as a single process per container)

const attempts = new Map<string, { n: number; until: number }>();

export async function login(email: string, password: string, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = `${ip}:${email.toLowerCase()}`;
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase()));
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH).then(() => false);
  if (!ok || !user) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 });
    return { ok: false, error: "Email or password is incorrect." };
  }
  attempts.delete(key);
  await startSession(user.id, user.workspaceId);
  return { ok: true };
}
// Constant-time-ish path for unknown emails.
const DUMMY_HASH = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function createAdmin(db: DB, workspaceId: string, email: string, password: string, name?: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ workspaceId, email: email.trim().toLowerCase(), name: name?.trim() || null, passwordHash: await hashPassword(password) })
    .returning();
  return user;
}

// ---- API keys (for MCP clients, scripts and the REST API)

export async function createApiKey(workspaceId: string, name: string) {
  const db = await getDb();
  const key = `al_${randomToken(24)}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ workspaceId, name: name.trim() || "API key", prefix: key.slice(0, 10), keyHash: sha256(key) })
    .returning();
  return { key, row };
}

export async function workspaceFromApiKey(key: string): Promise<Workspace | null> {
  if (!key.startsWith("al_")) return null;
  const db = await getDb();
  const [row] = await db
    .select({ key: schema.apiKeys, workspace: schema.workspaces })
    .from(schema.apiKeys)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.apiKeys.workspaceId))
    .where(and(eq(schema.apiKeys.keyHash, sha256(key)), isNull(schema.apiKeys.revokedAt)));
  if (!row) return null;
  // Best-effort usage stamp; not worth failing a request over.
  db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.key.id)).catch(() => undefined);
  return row.workspace;
}

/** REST/MCP auth: `Authorization: Bearer al_...` or the dashboard session cookie. */
export async function authenticateRequest(req: Request): Promise<Workspace | null> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer) return workspaceFromApiKey(bearer);
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const user = await userFromSessionToken(token ? decodeURIComponent(token) : undefined);
  return user?.workspace ?? null;
}
