"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  acceptInvitation,
  audit,
  auditForUser,
  clearPasswordFailures,
  completeSignIn,
  createOrganizationWithOwner,
  createUser,
  defaultWorkspaceFor,
  endSession,
  findInvitation,
  getSessionUser,
  hasUsers,
  InvitationError,
  login,
  passwordAttemptsLocked,
  pendingChallengeUser,
  recordPasswordFailure,
  startSession,
  verifySecondFactor,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { ipFromHeaders, rateLimit } from "@/lib/http";
import { log } from "@/lib/log";
import { MFA_COOKIE } from "@/lib/security/mfa";
import { passwordProblem } from "@/lib/security/password-policy";
import { safeRedirectPath } from "@/lib/url";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> } | undefined;

const setupSchema = z.object({
  organizationName: z.string().trim().min(1, "Give your business or agency a name").max(80),
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().max(1000),
  currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency"),
  timezone: z.string().min(1).max(64),
  start: z.enum(["demo", "setup"]).default("demo"),
});

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message]));

let setupQueue: Promise<unknown> = Promise.resolve();

export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await getDb();
  if (await hasUsers(db)) redirect("/login");
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = setupSchema.safeParse({ ...raw, name: raw.name || undefined });
  // Echo non-secret values back: React resets the form after an action.
  const values = Object.fromEntries(["organizationName", "name", "email", "currency", "timezone", "start"].map((k) => [k, String(form.get(k) ?? "")]));
  if (!parsed.success) return { values, fieldErrors: fieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const weak = passwordProblem(v.password, { email: v.email, name: v.name });
  if (weak) return { values, fieldErrors: { password: weak } };
  try {
    Intl.DateTimeFormat("en-US", { timeZone: v.timezone });
  } catch {
    return { values, fieldErrors: { timezone: "Unknown timezone" } };
  }
  // First-run setup must happen once: serialize concurrent submissions and re-check.
  const attempt = setupQueue.catch(() => null).then(async () => {
    if (await hasUsers(db)) return null;
    return createOrganizationWithOwner(db, {
      organizationName: v.organizationName,
      email: v.email,
      password: v.password,
      name: v.name,
      reportingCurrency: v.currency,
      timezone: v.timezone,
    });
  });
  setupQueue = attempt;
  const created = await attempt;
  if (!created) redirect("/login");
  const { workspace, user, organization } = created;
  await audit({ id: user.id, organizationId: organization.id, workspaceId: workspace.id }, "organization.created", organization.name);
  if (v.start === "demo") {
    try {
      await seedDemo(db, workspace.id);
    } catch (err) {
      log.error("demo seed failed", err);
    }
  }
  await startSession(user.id, workspace.id, "setup");
  redirect(v.start === "demo" ? "/" : "/onboarding");
}

async function clientIp() {
  return ipFromHeaders(await headers());
}

const TOO_MANY = "Too many attempts. Try again in a few minutes.";

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").slice(0, 320);
  const password = String(form.get("password") ?? "").slice(0, 1000);
  const ip = await clientIp();
  // Password spraying across many emails from one address.
  if (!rateLimit(`login:${ip}`, 20)) return { error: TOO_MANY, values: { email } };
  const r = await login(email, password, ip);
  if (!r.ok) return { error: r.error, values: { email } };
  const next = safeRedirectPath(form.get("next"));
  if (r.mfa) redirect(next === "/" ? "/login/verify" : `/login/verify?next=${encodeURIComponent(next)}`);
  redirect(next);
}

/** Second step of sign-in: a code from the authenticator app, or a recovery code. */
export async function verifyLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const pending = await pendingChallengeUser();
  if (!pending) return { error: "This sign-in took too long. Start again with your email and password." };
  const ip = await clientIp();
  // Same lockout as passwords, keyed on the account: 5 wrong codes per IP, 20 overall, per 15 minutes.
  if (!rateLimit(`login:${ip}`, 20) || passwordAttemptsLocked(`2fa:${pending.email}`, ip)) return { error: TOO_MANY };
  const code = String(form.get("code") ?? "").slice(0, 40);
  const r = await verifySecondFactor(pending.id, code);
  if (!r.ok) {
    recordPasswordFailure(`2fa:${pending.email}`, ip);
    await auditForUser(pending.id, "auth.login_failed", { reason: "code" });
    return { error: "That code didn't work. Enter the 6-digit code your app shows now, or a recovery code." };
  }
  clearPasswordFailures(`2fa:${pending.email}`, ip);
  const workspaceId = await defaultWorkspaceFor(pending.id);
  if (!workspaceId) return { error: "Your account isn't part of any workspace yet. Ask an admin to invite you again." };
  await completeSignIn(pending.id, workspaceId, r.method === "recovery" ? "password+recovery" : "password+totp");
  if (r.method === "recovery") await auditForUser(pending.id, "account.recovery_code_used", { remaining: r.remaining ?? 0 });
  redirect(safeRedirectPath(form.get("next")));
}

/** Abandon a pending 2FA challenge and go back to the email + password step. */
export async function cancelLoginAction() {
  (await cookies()).delete(MFA_COOKIE);
  redirect("/login");
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) await audit(user, "auth.logout", null);
  await endSession();
  redirect("/login");
}

// ---- invitations

const acceptNewSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  password: z.string().max(1000),
});

/** Accept an invitation: creates the account if needed (or verifies the existing password). */
export async function acceptInviteAction(token: string, _prev: FormState, form: FormData): Promise<FormState> {
  const ip = await clientIp();
  // Invitation tokens are unguessable, but don't let anyone hammer the endpoint.
  if (!rateLimit(`invite:${ip}`, 10)) return { error: TOO_MANY };
  const found = typeof token === "string" && token.length <= 200 ? await findInvitation(token) : null;
  if (!found) return { error: "This invitation has expired or was already used. Ask for a new one." };
  const db = await getDb();
  const { invitation } = found;
  const current = await getSessionUser();
  let knownUserId: string | null = null;
  let newUser: { name: string; password: string } | null = null;

  // The account is always the invited email: a different signed-in user never gets the membership.
  if (current && current.email === invitation.email) {
    knownUserId = current.id;
  } else {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invitation.email));
    if (existing) {
      if (passwordAttemptsLocked(invitation.email, ip)) return { error: TOO_MANY };
      const password = String(form.get("password") ?? "").slice(0, 1000);
      if (!(await verifyPassword(password, existing.passwordHash))) {
        recordPasswordFailure(invitation.email, ip);
        return { error: "That password doesn't match your existing AdLedger account." };
      }
      clearPasswordFailures(invitation.email, ip);
      knownUserId = existing.id;
    } else {
      const parsed = acceptNewSchema.safeParse({ name: form.get("name"), password: form.get("password") });
      if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues), values: { name: String(form.get("name") ?? "") } };
      const weak = passwordProblem(parsed.data.password, { email: invitation.email, name: parsed.data.name });
      if (weak) return { fieldErrors: { password: weak }, values: { name: parsed.data.name } };
      newUser = parsed.data;
    }
  }
  let accepted: { userId: string; workspaceId: string | null };
  try {
    // Account creation and the (single-use) claim of the invitation succeed or fail together.
    accepted = await db.transaction(async (tx) => {
      const id = knownUserId ?? (await createUser(tx, invitation.email, newUser!.password, newUser!.name)).id;
      return { userId: id, workspaceId: await acceptInvitation(tx, invitation.id, id) };
    });
  } catch (err) {
    if (err instanceof InvitationError) return { error: err.message };
    throw err;
  }
  const { userId, workspaceId } = accepted;
  if (!workspaceId) return { error: "You were invited, but no workspace is shared with you yet. Ask the admin to grant access." };
  await audit({ id: userId, organizationId: invitation.organizationId, workspaceId }, "member.joined", invitation.email, { role: invitation.role });
  await startSession(userId, workspaceId, "invite");
  redirect("/");
}
