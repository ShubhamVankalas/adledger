"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { accessibleWorkspaces, audit } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";

// Personal account actions: profile, password, sessions, workspace switching.

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
    if (next.length < 8) return fail("New password must be at least 8 characters.");
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    if (!u || !(await verifyPassword(current, u.passwordHash))) return fail("Current password is incorrect.");
    await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id));
    // Sign out every other device.
    await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, user.sessionId)));
    await audit(user, "account.password_changed", user.email);
    return ok("Password changed. Other devices were signed out.");
  });
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (sessionId === user.sessionId) return fail("That's this device. Use Sign out instead.");
    const db = await getDb();
    await db.delete(schema.sessions).where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, user.id)));
    revalidatePath("/settings", "layout");
    return ok("Device signed out.");
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    const db = await getDb();
    await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, user.sessionId)));
    revalidatePath("/settings", "layout");
    return ok("Signed out of all other devices.");
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
