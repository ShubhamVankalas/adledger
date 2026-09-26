"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  acceptInvitation,
  audit,
  createOrganizationWithOwner,
  createUser,
  endSession,
  findInvitation,
  getSessionUser,
  hasUsers,
  login,
  startSession,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { log } from "@/lib/log";
import { eq } from "drizzle-orm";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> } | undefined;

const setupSchema = z.object({
  organizationName: z.string().trim().min(1, "Give your business or agency a name").max(80),
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency"),
  timezone: z.string().min(1).max(64),
  start: z.enum(["demo", "setup"]).default("demo"),
});

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message]));

export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await getDb();
  if (await hasUsers(db)) redirect("/login");
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = setupSchema.safeParse({ ...raw, name: raw.name || undefined });
  // Echo non-secret values back: React resets the form after an action.
  const values = Object.fromEntries(["organizationName", "name", "email", "currency", "timezone", "start"].map((k) => [k, String(form.get(k) ?? "")]));
  if (!parsed.success) return { values, fieldErrors: fieldErrors(parsed.error.issues) };
  const v = parsed.data;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: v.timezone });
  } catch {
    return { values, fieldErrors: { timezone: "Unknown timezone" } };
  }
  const { workspace, user, organization } = await createOrganizationWithOwner(db, {
    organizationName: v.organizationName,
    email: v.email,
    password: v.password,
    name: v.name,
    reportingCurrency: v.currency,
    timezone: v.timezone,
  });
  await audit({ id: user.id, organizationId: organization.id, workspaceId: workspace.id }, "organization.created", organization.name);
  if (v.start === "demo") {
    try {
      await seedDemo(db, workspace.id);
    } catch (err) {
      log.error("demo seed failed", err);
    }
  }
  await startSession(user.id, workspace.id);
  redirect(v.start === "demo" ? "/" : "/onboarding");
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const r = await login(email, password, await clientIp());
  if (!r.ok) return { error: r.error, values: { email } };
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

// ---- invitations

const acceptNewSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

/** Accept an invitation: creates the account if needed (or verifies the existing password). */
export async function acceptInviteAction(token: string, _prev: FormState, form: FormData): Promise<FormState> {
  const found = await findInvitation(token);
  if (!found) return { error: "This invitation has expired or was already used. Ask for a new one." };
  const db = await getDb();
  const { invitation } = found;
  const current = await getSessionUser();
  let userId: string;

  if (current && current.email === invitation.email) {
    userId = current.id;
  } else {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invitation.email));
    if (existing) {
      const password = String(form.get("password") ?? "");
      if (!(await verifyPassword(password, existing.passwordHash))) {
        return { error: "That password doesn't match your existing AdLedger account." };
      }
      userId = existing.id;
    } else {
      const parsed = acceptNewSchema.safeParse({ name: form.get("name"), password: form.get("password") });
      if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues), values: { name: String(form.get("name") ?? "") } };
      const user = await createUser(db, invitation.email, parsed.data.password, parsed.data.name);
      userId = user.id;
    }
  }
  const workspaceId = await db.transaction((tx) => acceptInvitation(tx, invitation.id, userId));
  if (!workspaceId) return { error: "You were invited, but no workspace is shared with you yet. Ask the admin to grant access." };
  await audit({ id: userId, organizationId: invitation.organizationId, workspaceId }, "member.joined", invitation.email, { role: invitation.role });
  await startSession(userId, workspaceId);
  redirect("/");
}
