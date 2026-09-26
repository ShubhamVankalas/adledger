import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { getDb, schema, type DB } from "./db";
import type { Role } from "./db/schema";
import { roleCan, type Permission } from "./permissions";
import type { Workspace } from "./settings";

export const SESSION_COOKIE = "al_session";
const SESSION_DAYS = 30;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

export type Organization = typeof schema.organizations.$inferSelect;
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  sessionId: string;
  organization: Organization;
  role: Role;
  /** Current workspace (switchable). */
  workspace: Workspace;
  /** Workspaces this user can open in the organization. */
  workspaces: Pick<Workspace, "id" | "name" | "isDemo">[];
  /** Every organization the user belongs to (for the organization switcher). */
  organizations: { id: string; name: string }[];
  can: (permission: Permission) => boolean;
};

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

export function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`;
}

/** Workspaces a membership can open (null workspaceIds = all in the organization). */
export async function accessibleWorkspaces(db: Q, organizationId: string, workspaceIds: string[] | null) {
  const all = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.organizationId, organizationId))
    .orderBy(asc(schema.workspaces.createdAt));
  return workspaceIds ? all.filter((w) => workspaceIds.includes(w.id)) : all;
}

export async function startSession(userId: string, workspaceId: string) {
  const db = await getDb();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt });
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
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
    .select({ session: schema.sessions, user: schema.users, workspace: schema.workspaces, organization: schema.organizations })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.workspaces.organizationId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!row) return null;
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, row.organization.id), eq(schema.memberships.userId, row.user.id)));
  // Removed from the organization, or no longer allowed in this workspace.
  if (!membership) return null;
  if (membership.workspaceIds && !membership.workspaceIds.includes(row.workspace.id)) return null;
  const workspaces = await accessibleWorkspaces(db, row.organization.id, membership.workspaceIds);
  const organizations = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, row.user.id));
  const role = membership.role;
  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    sessionId: row.session.id,
    organization: row.organization,
    role,
    workspace: row.workspace,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, isDemo: w.isDemo })),
    organizations,
    can: (p) => roleCan(role, p),
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For pages: signed-in user, or redirect to /setup (fresh install) or /login. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect((await hasUsers()) ? "/login" : "/setup");
  if (permission && !user.can(permission)) redirect("/?denied=1");
  return user;
}

/** First workspace a user can open (used after login / when switching organizations). */
export async function defaultWorkspaceFor(userId: string): Promise<string | null> {
  const db = await getDb();
  const memberships = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, userId)).orderBy(asc(schema.memberships.createdAt));
  for (const m of memberships) {
    const ws = await accessibleWorkspaces(db, m.organizationId, m.workspaceIds);
    if (ws[0]) return ws[0].id;
  }
  return null;
}

// ---- login throttling (in-memory; the app runs as a single process per container)

const attempts = new Map<string, { n: number; until: number }>();
// Constant-time-ish path for unknown emails.
const DUMMY_HASH = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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
  const workspaceId = await defaultWorkspaceFor(user.id);
  if (!workspaceId) return { ok: false, error: "Your account isn't part of any workspace yet. Ask an admin to invite you again." };
  await startSession(user.id, workspaceId);
  return { ok: true };
}

export async function createUser(db: Q, email: string, password: string, name?: string | null) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: email.trim().toLowerCase(), name: name?.trim() || null, passwordHash: await hashPassword(password) })
    .returning();
  return user;
}

/**
 * First-run / headless setup: organization + first workspace + owner account.
 * Returns the created rows.
 */
export async function createOrganizationWithOwner(
  db: DB,
  input: {
    organizationName: string;
    workspaceName?: string;
    email: string;
    password: string;
    name?: string | null;
    reportingCurrency?: string;
    timezone?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(schema.organizations)
      .values({ name: input.organizationName, slug: slugify(input.organizationName) })
      .returning();
    const wsName = input.workspaceName || input.organizationName;
    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({
        organizationId: organization.id,
        name: wsName,
        slug: slugify(wsName),
        reportingCurrency: input.reportingCurrency ?? "USD",
        timezone: input.timezone ?? "UTC",
      })
      .returning();
    const user = await createUser(tx, input.email, input.password, input.name);
    await tx.insert(schema.memberships).values({ organizationId: organization.id, userId: user.id, role: "owner" });
    return { organization, workspace, user };
  });
}

// ---- audit log

export async function audit(
  user: Pick<SessionUser, "id" | "organization" | "workspace"> | { id: string | null; organizationId: string; workspaceId?: string | null },
  action: string,
  target?: string | null,
  meta: Record<string, unknown> = {},
) {
  const db = await getDb();
  const organizationId = "organization" in user ? user.organization.id : user.organizationId;
  const workspaceId = "workspace" in user ? user.workspace.id : (user.workspaceId ?? null);
  await db.insert(schema.auditLog).values({ organizationId, workspaceId, userId: user.id, action, target: target ?? null, meta });
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

// ---- invitations

export const INVITE_DAYS = 7;

export async function createInvitation(
  actor: SessionUser,
  input: { email: string; role: Role; workspaceIds: string[] | null },
): Promise<{ token: string; id: string }> {
  const db = await getDb();
  const token = randomToken(24);
  const email = input.email.trim().toLowerCase();
  // Replace any pending invite for the same email.
  await db
    .delete(schema.invitations)
    .where(and(eq(schema.invitations.organizationId, actor.organization.id), eq(schema.invitations.email, email), isNull(schema.invitations.acceptedAt)));
  const [row] = await db
    .insert(schema.invitations)
    .values({
      organizationId: actor.organization.id,
      email,
      role: input.role,
      workspaceIds: input.role === "client" ? input.workspaceIds : null,
      tokenHash: sha256(token),
      invitedBy: actor.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning({ id: schema.invitations.id });
  return { token, id: row.id };
}

export async function findInvitation(token: string) {
  const db = await getDb();
  const [row] = await db
    .select({ invitation: schema.invitations, organization: schema.organizations })
    .from(schema.invitations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.invitations.organizationId))
    .where(and(eq(schema.invitations.tokenHash, sha256(token)), isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())));
  return row ?? null;
}

/** Add (or update) a user's membership from an invitation and mark it accepted. */
export async function acceptInvitation(db: Q, invitationId: string, userId: string) {
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invitationId));
  if (!inv) throw new Error("Invitation not found");
  await db
    .insert(schema.memberships)
    .values({ organizationId: inv.organizationId, userId, role: inv.role, workspaceIds: inv.workspaceIds })
    .onConflictDoUpdate({
      target: [schema.memberships.organizationId, schema.memberships.userId],
      set: { role: inv.role, workspaceIds: inv.workspaceIds },
    });
  await db.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, invitationId));
  const ws = await accessibleWorkspaces(db, inv.organizationId, inv.workspaceIds);
  return ws[0]?.id ?? null;
}

/** Owners must always exist: count remaining owners excluding one membership. */
export async function ownerCount(organizationId: string, excludingUserId?: string) {
  const db = await getDb();
  const [r] = await db
    .select({ n: count() })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.role, "owner"),
        excludingUserId ? sql`${schema.memberships.userId} <> ${excludingUserId}` : undefined,
      ),
    );
  return r?.n ?? 0;
}
