"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { accessibleWorkspaces, audit, passwordAttemptsLocked, recordPasswordFailure, startSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { ipFromHeaders } from "@/lib/http";
import { passwordProblem } from "@/lib/security/password-policy";

// Personal account actions: profile, password, workspace switching. Two-factor sign-in and
// sessions live in ./security.ts.

export async function updateProfileAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const name = str(form, "name").slice(0, 80);
    const db = await getDb();
    await db.update(schema.users).set({ name: name || null }).where(eq(schema.users.id, user.id));
    revalidatePath("/", "layout");
    return ok("Profile saved.");
  });
}

export async function changePasswordAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const current = String(form.get("current") ?? "");
    const next = String(form.get("next") ?? "");
    const problem = passwordProblem(next, { has2fa: user.has2fa, email: user.email, name: user.name });
    if (problem) return fail(problem);
    const ip = ipFromHeaders(await headers());
    if (passwordAttemptsLocked(user.email, ip)) return fail("Too many attempts. Try again in a few minutes.");
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    if (!u || !(await verifyPassword(current.slice(0, 1000), u.passwordHash))) {
      recordPasswordFailure(user.email, ip);
      return fail("Current password is incorrect.");
    }
    await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id));
    // Sign out every device, then give this one a brand-new session token.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await startSession(user.id, user.workspace.id, user.has2fa ? "password+totp" : "password");
    await audit(user, "account.password_changed", null);
    return ok("Password changed. Other devices were signed out.");
  });
}

export async function switchWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (!user.workspaces.some((w) => w.id === workspaceId)) return fail("You don't have access to that workspace.");
    const db = await getDb();
    await db.update(schema.sessions).set({ workspaceId }).where(eq(schema.sessions.id, user.sessionId));
    revalidatePath("/", "layout");
    return ok();
  });
}

export async function switchOrganizationAction(organizationId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const db = await getDb();
    const [m] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.organizationId, organizationId)));
    if (!m) return fail("You're not a member of that organization.");
    const [ws] = await accessibleWorkspaces(db, organizationId, m.workspaceIds);
    if (!ws) return fail("No workspace in that organization is shared with you yet.");
    await db.update(schema.sessions).set({ workspaceId: ws.id }).where(eq(schema.sessions.id, user.sessionId));
    revalidatePath("/", "layout");
    return ok();
  });
}
