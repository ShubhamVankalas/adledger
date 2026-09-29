import { and, asc, count, eq, getTableColumns, gt, isNull, lte, or, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { getDb, schema, type DB } from "./db";
import type { ApiScope, Role } from "./db/schema";
import { ipFromHeaders } from "./http";
import { log } from "./log";
import { mediaUrl } from "./media";
import { canAssign, findRoleDef, roleDefCan, type Permission, type RoleDef } from "./permissions";
import { appendAudit } from "./security/audit-chain";
import { deviceKey, shortUserAgent, truncateIp } from "./security/device";
import { createChallenge, MFA_COOKIE, openSecret, readChallenge } from "./security/mfa";
import { listOrgRoles, orgRolesCached } from "./roles";
import { parsePolicy, sessionExpired, type SecurityPolicy } from "./security/policy";
import { consumeRecoveryCode, looksLikeRecoveryCode } from "./security/recovery";
import { DEFAULT_SCOPES } from "./security/scopes";
import { verifyTotp } from "./security/totp";
import type { Workspace } from "./settings";

export const SESSION_COOKIE = "al_session";
/** Upper bound for the cookie; the organization's policy (default 30 days) is enforced per request. */
const SESSION_DAYS = 90;
/** last_seen_at is refreshed at most this often (idle timeouts are coarse by design). */
const TOUCH_EVERY_MS = 5 * 60_000;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

// Image bytes stay out of the per-request session query; they are served by /api/media.
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}
const organizationColumns = without(getTableColumns(schema.organizations), "logo", "logoPng");
const userColumns = without(getTableColumns(schema.users), "avatar", "passwordHash", "totpSecretEnc", "recoveryCodes", "totpLastStep");

export type Organization = Omit<typeof schema.organizations.$inferSelect, "logo" | "logoPng"> & { logoUrl: string | null };
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  /** Profile picture URL (cache-busting), or null to show initials. */
  avatarUrl: string | null;
  sessionId: string;
  organization: Organization;
  role: Role;
  /** The organization's definition of that role (null if it was deleted: no permissions). */
  roleDef: RoleDef | null;
  /** Display name of the role ("Analyst", or a custom role's name). */
  roleName: string;
  /** Current workspace (switchable). */
  workspace: Workspace;
  /** Workspaces this user can open in the organization. */
  workspaces: Pick<Workspace, "id" | "name" | "isDemo">[];
  /** Every organization the user belongs to (for the organization switcher). */
  organizations: { id: string; name: string; logoUrl: string | null }[];
  can: (permission: Permission) => boolean;
  /** Two-factor sign-in is on for this account. */
  has2fa: boolean;
  /** When the user finished or skipped the product tour (null: offer it). */
  tourCompletedAt: Date | null;
  /** The organization requires 2FA and this account hasn't set it up: only enrolment is allowed. */
  needs2fa: boolean;
  /** The current organization's security policy (parsed with defaults). */
  security: SecurityPolicy;
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

/** Truncated IP and user agent of the current request (nulls outside a request, e.g. in jobs). */
export async function requestContext(): Promise<{ ip: string; ipTrunc: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip = ipFromHeaders(h);
    return { ip, ipTrunc: ip === "0.0.0.0" ? null : truncateIp(ip), userAgent: shortUserAgent(h.get("user-agent")) };
  } catch {
    return { ip: "0.0.0.0", ipTrunc: null, userAgent: null };
  }
}

export type AuthMethod = "password" | "password+totp" | "password+recovery" | "invite" | "setup";

/**
 * Issue a fresh session token (never reuse one the browser already had: prevents session
 * fixation). Any session the browser was carrying is revoked first.
 */
export async function startSession(userId: string, workspaceId: string, authMethod: AuthMethod = "password") {
  const db = await getDb();
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(previous)));
  // Housekeeping: drop expired sessions for this user.
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), lte(schema.sessions.expiresAt, new Date())));
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const { ipTrunc, userAgent } = await requestContext();
  const now = new Date();
  await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt, ipTrunc, userAgent, lastSeenAt: now, authMethod });
  await db.update(schema.users).set({ lastLoginAt: now }).where(eq(schema.users.id, userId));
  jar.delete(MFA_COOKIE);
  jar.set(SESSION_COOKIE, token, {
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
    .select({ session: schema.sessions, user: userColumns, workspace: schema.workspaces, organization: organizationColumns })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.workspaces.organizationId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!row) return null;
  const security = parsePolicy(row.organization.security);
  // Idle timeout and maximum lifetime come from the organization's policy.
  if (sessionExpired(row.session, security)) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, row.session.id));
    return null;
  }
  if (Date.now() - (row.session.lastSeenAt ?? row.session.createdAt).getTime() > TOUCH_EVERY_MS) {
    // Best effort: a failed stamp must not fail the request.
    db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, row.session.id)).catch(() => undefined);
  }
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, row.organization.id), eq(schema.memberships.userId, row.user.id)));
  // Removed from the organization, or no longer allowed in this workspace.
  if (!membership) return null;
  if (membership.workspaceIds && !membership.workspaceIds.includes(row.workspace.id)) return null;
  const workspaces = await accessibleWorkspaces(db, row.organization.id, membership.workspaceIds);
  const organizations = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name, logoUpdatedAt: schema.organizations.logoUpdatedAt })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, row.user.id));
  const role = membership.role;
  const roleDef = findRoleDef(await orgRolesCached(row.organization.id), role);
  const has2fa = Boolean(row.user.totpEnabledAt);
  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    avatarUrl: mediaUrl("user", row.user.id, row.user.avatarUpdatedAt),
    sessionId: row.session.id,
    organization: { ...row.organization, logoUrl: mediaUrl("org", row.organization.id, row.organization.logoUpdatedAt) },
    role,
    roleDef,
    roleName: roleDef?.name ?? role,
    workspace: row.workspace,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, isDemo: w.isDemo })),
    organizations: organizations.map((o) => ({ id: o.id, name: o.name, logoUrl: mediaUrl("org", o.id, o.logoUpdatedAt) })),
    can: (p) => roleDefCan(roleDef, p, security),
    has2fa,
    tourCompletedAt: row.user.tourCompletedAt,
    needs2fa: security.require2fa && !has2fa,
    security,
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * For pages: signed-in user, or redirect to /setup (fresh install) or /login. Members of an
 * organization that requires 2FA go to enrolment until they have set it up.
 */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect((await hasUsers()) ? "/login" : "/setup");
  if (user.needs2fa) redirect("/two-factor/setup");
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

const failures = new Map<string, { n: number; until: number }>();
const FAILURE_WINDOW_MS = 15 * 60_000;
/** Failed password checks allowed per (IP, email) and per email from any IP, per 15 minutes. */
export const MAX_FAILURES_PER_IP_EMAIL = 5;
export const MAX_FAILURES_PER_EMAIL = 20;
// Constant-time-ish path for unknown emails.
const DUMMY_HASH = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function failureKeys(email: string, ip: string) {
  const e = email.trim().toLowerCase();
  return [
    { key: `ip:${ip}:${e}`, max: MAX_FAILURES_PER_IP_EMAIL },
    // Per-account cap: client IPs come from proxy headers and can be spoofed or rotated.
    { key: `email:${e}`, max: MAX_FAILURES_PER_EMAIL },
  ];
}

/** True when password attempts for this email (from this IP, or overall) are locked out. */
export function passwordAttemptsLocked(email: string, ip: string): boolean {
  const now = Date.now();
  return failureKeys(email, ip).some(({ key, max }) => {
    const f = failures.get(key);
    return Boolean(f && f.until > now && f.n >= max);
  });
}

export function recordPasswordFailure(email: string, ip: string) {
  const now = Date.now();
  for (const { key } of failureKeys(email, ip)) {
    const f = failures.get(key);
    failures.set(key, { n: f && f.until > now ? f.n + 1 : 1, until: now + FAILURE_WINDOW_MS });
  }
  if (failures.size > 50_000) failures.clear();
}

export function clearPasswordFailures(email: string, ip: string) {
  failures.delete(failureKeys(email, ip)[0].key);
}

/** Tests only. */
export function resetPasswordThrottle() {
  failures.clear();
}

export type LoginResult = { ok: true; mfa?: boolean } | { ok: false; error: string };

/**
 * Check email + password. With 2FA on, no session is created yet: the browser gets a short-lived
 * challenge cookie and the caller sends it to /login/verify for the code.
 */
export async function login(email: string, password: string, ip: string): Promise<LoginResult> {
  if (passwordAttemptsLocked(email, ip)) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase()));
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, DUMMY_HASH).then(() => false);
  if (!ok || !user) {
    recordPasswordFailure(email, ip);
    if (user) await auditForUser(user.id, "auth.login_failed", { reason: "password" });
    return { ok: false, error: "Email or password is incorrect." };
  }
  clearPasswordFailures(email, ip);
  const workspaceId = await defaultWorkspaceFor(user.id);
  if (!workspaceId) return { ok: false, error: "Your account isn't part of any workspace yet. Ask an admin to invite you again." };
  if (user.totpEnabledAt && user.totpSecretEnc) {
    const jar = await cookies();
    jar.set(MFA_COOKIE, await createChallenge(user.id), { httpOnly: true, sameSite: "lax", secure: await isHttps(), path: "/", maxAge: 600 });
    return { ok: true, mfa: true };
  }
  await completeSignIn(user.id, workspaceId, "password");
  return { ok: true };
}

/** Start the session and record the sign-in (audit entry, new-device alert and email). */
export async function completeSignIn(userId: string, workspaceId: string, method: AuthMethod) {
  await startSession(userId, workspaceId, method);
  const { userAgent } = await requestContext();
  const device = deviceKey(userAgent);
  const db = await getDb();
  const [ws] = await db.select({ organizationId: schema.workspaces.organizationId }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return;
  // A device is "new" when this account has signed in before, but never with this browser + OS.
  const previous = await db
    .select({ device: sql<string | null>`${schema.auditLog.meta}->>'device'` })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.userId, userId), eq(schema.auditLog.action, "auth.login")))
    .orderBy(sql`${schema.auditLog.createdAt} desc`)
    .limit(500);
  const actor = { id: userId, organizationId: ws.organizationId, workspaceId };
  await audit(actor, "auth.login", null, { method, device });
  if (previous.length > 0 && !previous.some((p) => p.device === device)) {
    await audit(actor, "auth.new_device", null, { device });
    const notice = import("./security/new-device").then((m) => m.emailNewDevice(userId, workspaceId, device));
    if (process.env.ADLEDGER_SYNC_JOBS === "1") await notice.catch(() => undefined);
    else notice.catch(() => undefined);
  }
}

/** The user a pending 2FA challenge (cookie) belongs to, or null. */
export async function pendingChallengeUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const userId = await readChallenge((await cookies()).get(MFA_COOKIE)?.value);
  if (!userId) return null;
  const db = await getDb();
  const [u] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, enabled: schema.users.totpEnabledAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return u?.enabled ? { id: u.id, email: u.email, name: u.name } : null;
}

/**
 * Check a TOTP code (or a recovery code) for a user. A TOTP step is accepted once: the update of
 * totp_last_step is conditional, so two requests racing with the same code can't both win.
 */
export async function verifySecondFactor(userId: string, input: string): Promise<{ ok: true; method: "totp" | "recovery"; remaining?: number } | { ok: false }> {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.totpSecretEnc) return { ok: false };
  if (looksLikeRecoveryCode(input)) {
    if (!u.totpEnabledAt) return { ok: false };
    const remaining = await consumeRecoveryCode(input, u.recoveryCodes);
    if (!remaining) return { ok: false };
    // Conditional on the stored list being unchanged: one code can't be spent twice concurrently.
    const [updated] = await db
      .update(schema.users)
      .set({ recoveryCodes: remaining })
      .where(and(eq(schema.users.id, userId), sql`cardinality(${schema.users.recoveryCodes}) = ${u.recoveryCodes.length}`))
      .returning({ id: schema.users.id });
    return updated ? { ok: true, method: "recovery", remaining: remaining.length } : { ok: false };
  }
  const step = verifyTotp(await openSecret(u.totpSecretEnc), input, { lastStep: u.totpLastStep });
  if (step === null) return { ok: false };
  const [updated] = await db
    .update(schema.users)
    .set({ totpLastStep: step })
    .where(and(eq(schema.users.id, userId), or(isNull(schema.users.totpLastStep), sql`${schema.users.totpLastStep} < ${step}`)))
    .returning({ id: schema.users.id });
  return updated ? { ok: true, method: "totp" } : { ok: false };
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

export type AuditActor = Pick<SessionUser, "id" | "organization" | "workspace"> | { id: string | null; organizationId: string; workspaceId?: string | null };

/**
 * Append an entry to the organization's tamper-evident audit log, with the request's truncated IP
 * and user agent. Security-relevant actions also raise a `security_alert` notification.
 * Never pass emails, phone numbers or tokens in `target` or `meta`.
 */
export async function audit(
  user: AuditActor,
  action: string,
  target?: string | null,
  meta: Record<string, unknown> = {},
  /** Request context captured earlier (e.g. before a streamed download finishes). */
  context?: { ipTrunc: string | null; userAgent: string | null },
) {
  const db = await getDb();
  const organizationId = "organization" in user ? user.organization.id : user.organizationId;
  const workspaceId = "workspace" in user ? user.workspace.id : (user.workspaceId ?? null);
  const { ipTrunc, userAgent } = context ?? (await requestContext());
  const entry = { organizationId, workspaceId, userId: user.id, action, target: target ?? null, meta, ipTrunc, userAgent };
  await appendAudit(db, entry);
  if (ALERTING_ACTIONS.has(action)) {
    // Loaded on demand: the notification stack is large and most audit entries don't alert.
    const alert = import("./security/alerts").then((m) => m.raiseSecurityAlert(entry, db));
    if (process.env.ADLEDGER_SYNC_JOBS === "1") await alert.catch(() => undefined);
    else alert.catch((err) => log.warn("security alert failed", err));
  }
}

/** Audit an account-level event (e.g. a failed sign-in) in every organization the user belongs to. */
export async function auditForUser(userId: string, action: string, meta: Record<string, unknown> = {}) {
  const db = await getDb();
  const orgs = await db.select({ id: schema.memberships.organizationId }).from(schema.memberships).where(eq(schema.memberships.userId, userId));
  for (const o of orgs) await audit({ id: userId, organizationId: o.id, workspaceId: null }, action, null, meta);
}

/** Actions that raise a security alert (see lib/security/alerts.ts). */
const ALERTING_ACTIONS = new Set(["api_key.created", "member.updated", "account.2fa_disabled", "security.2fa_reset", "contacts.exported", "workspace.exported", "contact.erased", "auth.new_device"]);

// ---- API keys (for MCP clients, scripts and the REST API)

export async function createApiKey(workspaceId: string, name: string, scopes: ApiScope[] = DEFAULT_SCOPES, expiresAt: Date | null = null) {
  const db = await getDb();
  const key = `al_${randomToken(24)}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ workspaceId, name: name.trim() || "API key", prefix: key.slice(0, 10), keyHash: sha256(key), scopes, expiresAt })
    .returning();
  return { key, row };
}

export type ApiKeyInfo = { id: string; name: string; scopes: ApiScope[] };

/** The workspace and scopes of a live (not revoked, not expired) API key, or null. */
export async function apiKeyFromBearer(key: string, ip?: string): Promise<{ workspace: Workspace; key: ApiKeyInfo } | null> {
  if (!key.startsWith("al_") || key.length > 200) return null;
  const db = await getDb();
  const [row] = await db
    .select({ key: schema.apiKeys, workspace: schema.workspaces })
    .from(schema.apiKeys)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.apiKeys.workspaceId))
    .where(and(eq(schema.apiKeys.keyHash, sha256(key)), isNull(schema.apiKeys.revokedAt)));
  if (!row) return null;
  if (row.key.expiresAt && row.key.expiresAt.getTime() <= Date.now()) return null;
  // Best-effort usage stamp; not worth failing a request over.
  db.update(schema.apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIpTrunc: ip ? truncateIp(ip) : null })
    .where(eq(schema.apiKeys.id, row.key.id))
    .catch(() => undefined);
  return { workspace: row.workspace, key: { id: row.key.id, name: row.key.name, scopes: row.key.scopes } };
}

/** @deprecated use apiKeyFromBearer (it also returns the key's scopes). */
export async function workspaceFromApiKey(key: string): Promise<Workspace | null> {
  return (await apiKeyFromBearer(key))?.workspace ?? null;
}

/**
 * Who is calling a REST/MCP endpoint. API keys are workspace-scoped and limited to their scopes;
 * a dashboard session carries its member's role (checked per route).
 */
export type Principal = { kind: "api_key"; workspace: Workspace; key: ApiKeyInfo } | { kind: "session"; workspace: Workspace; user: SessionUser };

/**
 * REST/MCP auth: `Authorization: Bearer al_...` or the dashboard session cookie. A session that
 * still has to enrol in 2FA (organization policy) only counts when `allowPending2fa` is set.
 */
export async function authenticatePrincipal(req: Request, opts: { allowPending2fa?: boolean } = {}): Promise<Principal | null> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer) {
    const found = await apiKeyFromBearer(bearer, ipFromHeaders(req.headers));
    return found ? { kind: "api_key", workspace: found.workspace, key: found.key } : null;
  }
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  let raw: string | undefined;
  try {
    raw = token ? decodeURIComponent(token) : undefined;
  } catch {
    return null;
  }
  const user = await userFromSessionToken(raw);
  if (!user || (user.needs2fa && !opts.allowPending2fa)) return null;
  return { kind: "session", workspace: user.workspace, user };
}

/** The workspace a REST/MCP request may read, or null when unauthenticated. */
export async function authenticateRequest(req: Request): Promise<Workspace | null> {
  return (await authenticatePrincipal(req))?.workspace ?? null;
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
      workspaceIds: input.workspaceIds,
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

export class InvitationError extends Error {}

/**
 * Add (or update) a user's membership from an invitation and mark it accepted.
 * - Single use: the invitation is claimed atomically (a second, concurrent accept fails).
 * - The inviter must still be allowed to grant the role (e.g. an owner demoted to admin
 *   can no longer turn someone into an owner with an old link).
 * - An invitation never demotes an existing owner.
 */
export async function acceptInvitation(db: Q, invitationId: string, userId: string) {
  const now = new Date();
  const [inv] = await db
    .update(schema.invitations)
    .set({ acceptedAt: now })
    .where(and(eq(schema.invitations.id, invitationId), isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, now)))
    .returning();
  if (!inv) throw new InvitationError("This invitation has expired or was already used. Ask for a new one.");

  const roles = await listOrgRoles(db, inv.organizationId);
  const target = findRoleDef(roles, inv.role);
  if (!target) throw new InvitationError("The role in this invitation no longer exists. Ask for a new invitation.");
  if (inv.invitedBy) {
    const [inviter] = await db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, inv.organizationId), eq(schema.memberships.userId, inv.invitedBy)));
    if (!inviter || !canAssign(findRoleDef(roles, inviter.role), target)) {
      throw new InvitationError("The person who invited you can no longer grant this role. Ask for a new invitation.");
    }
  } else if (inv.role === "owner") {
    throw new InvitationError("This invitation is no longer valid. Ask for a new one.");
  }

  const [existing] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, inv.organizationId), eq(schema.memberships.userId, userId)));
  if (existing?.role === "owner") {
    // Already an owner: keep full access rather than letting a stale link downgrade them.
    const ws = await accessibleWorkspaces(db, inv.organizationId, existing.workspaceIds);
    return ws[0]?.id ?? null;
  }
  // Only workspace-scoped roles (like Client) are limited to the invitation's workspaces.
  const workspaceIds = target.workspaceScoped ? inv.workspaceIds : null;
  await db
    .insert(schema.memberships)
    .values({ organizationId: inv.organizationId, userId, role: inv.role, workspaceIds })
    .onConflictDoUpdate({
      target: [schema.memberships.organizationId, schema.memberships.userId],
      set: { role: inv.role, workspaceIds },
    });
  const ws = await accessibleWorkspaces(db, inv.organizationId, workspaceIds);
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
