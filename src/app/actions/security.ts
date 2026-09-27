"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Denied, fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit, getSessionUser, verifySecondFactor, type SessionUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { rateLimit } from "@/lib/http";
import { verifyAuditChain } from "@/lib/security/audit-chain";
import { IDLE_CHOICES, MAX_DAYS_CHOICES, parsePolicy } from "@/lib/security/policy";
import { beginEnrollment, confirmEnrollment, disableTwoFactor, regenerateRecoveryCodes } from "@/lib/security/two-factor";
import { UUID_RE } from "@/lib/request-auth";

// Security actions: contact PII reveal, two-factor sign-in, sessions, the organization's security
// policy and audit-log verification. Every change is audited.

/**
 * The signed-in user for account-security actions. Unlike guard(), it also accepts a member who
 * still has to enrol in 2FA, so the forced enrolment screen can use these actions.
 */
async function accountGuard(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Denied("Your session has expired. Sign in again.");
  return user;
}

/** Per-user brake on code guessing (codes are 6 digits). */
function codeAttemptAllowed(userId: string) {
  return rateLimit(`2fa-action:${userId}`, 10);
}

// ---------------------------------------------------------------- contact PII

/** Unmask contact emails for members with contacts.pii. Every reveal is audited. */
export async function revealContactEmailsAction(ids: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.pii");
    const clean = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => typeof id === "string" && UUID_RE.test(id)).slice(0, 200);
    if (clean.length === 0) return fail("Nothing to reveal.");
    const db = await getDb();
    const rows = await db
      .select({ id: schema.contacts.id, email: schema.contacts.email })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), inArray(schema.contacts.id, clean)));
    const emails = Object.fromEntries(rows.filter((r) => r.email).map((r) => [r.id, r.email!]));
    await audit(user, "contact.pii_revealed", rows.length === 1 ? rows[0].id : null, { count: Object.keys(emails).length, fields: ["email"] });
    return ok(undefined, { emails });
  });
}

// ---------------------------------------------------------------- two-factor sign-in

export async function startTwoFactorAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await accountGuard();
    const enrollment = await beginEnrollment(user.id, user.email);
    if (!enrollment) return fail("Two-factor sign-in is already on.");
    return ok(undefined, { ...enrollment });
  });
}

export async function confirmTwoFactorAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await accountGuard();
    if (!codeAttemptAllowed(user.id)) return fail("Too many attempts. Wait a minute and try again.");
    const result = await confirmEnrollment(user.id, str(form, "code"));
    if (!result) return fail("That code didn't match. Check the time on your phone is set automatically, then enter the newest code.");
    await audit(user, "account.2fa_enabled", null);
    revalidatePath("/", "layout");
    return ok("Two-factor sign-in is on.", { codes: result.codes });
  });
}

export async function disableTwoFactorAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (user.security.require2fa) return fail("Your organization requires two-factor sign-in, so it can't be turned off. An owner can change that in Organization → Security.");
    if (!codeAttemptAllowed(user.id)) return fail("Too many attempts. Wait a minute and try again.");
    const check = await verifySecondFactor(user.id, str(form, "code"));
    if (!check.ok) return fail("That code didn't match. Enter the current code from your app, or one of your recovery codes.");
    await disableTwoFactor(user.id);
    await audit(user, "account.2fa_disabled", null, { via: check.method });
    revalidatePath("/", "layout");
    return ok("Two-factor sign-in is off.");
  });
}

export async function regenerateRecoveryCodesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (!user.has2fa) return fail("Turn on two-factor sign-in first.");
    if (!codeAttemptAllowed(user.id)) return fail("Too many attempts. Wait a minute and try again.");
    const check = await verifySecondFactor(user.id, str(form, "code"));
    if (!check.ok) return fail("That code didn't match. Enter the current code from your app.");
    const codes = await regenerateRecoveryCodes(user.id);
    await audit(user, "account.recovery_codes_regenerated", null);
    revalidatePath("/settings", "layout");
    return ok("New recovery codes created. The old ones no longer work.", { codes });
  });
}

/** Owners can reset another member's 2FA (lost phone). The member sets it up again at next sign-in if required. */
export async function resetMemberTwoFactorAction(userId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("security.manage");
    if (!UUID_RE.test(userId) || userId === user.id) return fail("Use your own Security page to change your two-factor sign-in.");
    const db = await getDb();
    const [m] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, user.organization.id), eq(schema.memberships.userId, userId)));
    if (!m) return fail("That person isn't a member of this organization.");
    // 2FA protects the whole account, so only reset it when every organization the person belongs
    // to is one this owner also owns. Otherwise one organization could weaken sign-in to another.
    const theirs = await db.select({ organizationId: schema.memberships.organizationId }).from(schema.memberships).where(eq(schema.memberships.userId, userId));
    const owned = await db
      .select({ organizationId: schema.memberships.organizationId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.role, "owner")));
    const ownedIds = new Set(owned.map((o) => o.organizationId));
    if (theirs.some((t) => !ownedIds.has(t.organizationId))) {
      return fail("This person also belongs to another organization, so only they can change their two-factor sign-in (with a recovery code).");
    }
    await disableTwoFactor(userId);
    // Their open sessions end too, so the reset takes effect everywhere.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit(user, "security.2fa_reset", userId);
    revalidatePath("/settings", "layout");
    return ok("Two-factor sign-in was reset. They'll be asked to set it up again if it's required.");
  });
}

// ---------------------------------------------------------------- sessions

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (sessionId === user.sessionId) return fail("That's this device. Use Sign out instead.");
    if (!UUID_RE.test(sessionId)) return fail("That session has already ended.");
    const db = await getDb();
    const gone = await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, user.id)))
      .returning({ id: schema.sessions.id });
    if (gone.length) await audit(user, "session.revoked", null, { count: 1 });
    revalidatePath("/settings", "layout");
    return ok("Device signed out.");
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const db = await getDb();
    const gone = await db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, user.sessionId)))
      .returning({ id: schema.sessions.id });
    await audit(user, "session.revoked_all", null, { count: gone.length });
    revalidatePath("/settings", "layout");
    return ok(gone.length ? `Signed out of ${gone.length} other device${gone.length === 1 ? "" : "s"}.` : "No other devices were signed in.");
  });
}

// ---------------------------------------------------------------- organization policy

export async function saveSecurityPolicyAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("security.manage");
    const idle = Number(str(form, "sessionIdleMinutes"));
    const maxDays = Number(str(form, "sessionMaxDays"));
    if (!IDLE_CHOICES.some((c) => c.minutes === idle)) return fail("Pick an idle timeout from the list.");
    if (!MAX_DAYS_CHOICES.some((c) => c.days === maxDays)) return fail("Pick a maximum session length from the list.");
    const require2fa = form.get("require2fa") === "on";
    if (require2fa && !user.has2fa) return fail("Turn on two-factor sign-in for your own account first, so you can't lock yourself out.");
    const next = {
      ...user.organization.security,
      require2fa,
      sessionIdleMinutes: idle,
      sessionMaxDays: maxDays,
      clientsCanDownloadPdf: form.get("clientsCanDownloadPdf") === "on",
    };
    const policy = parsePolicy(next);
    const db = await getDb();
    await db.update(schema.organizations).set({ security: policy }).where(eq(schema.organizations.id, user.organization.id));
    const before = user.security;
    const changed = Object.fromEntries(Object.entries(policy).filter(([k, v]) => before[k as keyof typeof before] !== v));
    await audit(user, "security.policy_updated", null, changed);
    revalidatePath("/", "layout");
    return ok("Security policy saved.");
  });
}

// ---------------------------------------------------------------- audit log

export async function verifyAuditLogAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("audit.view");
    const db = await getDb();
    const report = await verifyAuditChain(db, user.organization.id);
    await audit(user, "audit.verified", null, { ok: report.ok, checked: report.checked, brokenAt: report.brokenAt, reason: report.reason });
    revalidatePath("/settings", "layout");
    return report.ok
      ? ok(`All ${report.checked.toLocaleString("en-US")} entries verified. Nothing was edited or removed.`, { ...report })
      : { ok: false, message: `Entry #${report.brokenAt} doesn't match its hash: it was ${report.reason === "missing" ? "removed" : "changed"} after it was written.`, data: { ...report } };
  });
}
