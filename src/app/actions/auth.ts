"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdmin, endSession, hasUsers, login, startSession } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { log } from "@/lib/log";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> } | undefined;

const setupSchema = z.object({
  workspaceName: z.string().trim().min(1, "Give your workspace a name").max(80),
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency"),
  timezone: z.string().min(1).max(64),
  demo: z.enum(["on", "off"]).default("off"),
});

export async function setupAction(_prev: FormState, form: FormData): Promise<FormState> {
  const db = await getDb();
  if (await hasUsers(db)) redirect("/login");
  const parsed = setupSchema.safeParse({
    workspaceName: form.get("workspaceName"),
    name: form.get("name") || undefined,
    email: form.get("email"),
    password: form.get("password"),
    currency: form.get("currency"),
    timezone: form.get("timezone"),
    demo: form.get("demo") === "on" ? "on" : "off",
  });
  // Echo non-secret values back: React resets the form after an action.
  const values = Object.fromEntries(["workspaceName", "name", "email", "currency", "timezone"].map((k) => [k, String(form.get(k) ?? "")]));
  if (!parsed.success) {
    return { values, fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const v = parsed.data;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: v.timezone });
  } catch {
    return { values, fieldErrors: { timezone: "Unknown timezone" } };
  }
  const slug = v.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  const { ws, user } = await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name: v.workspaceName, slug, reportingCurrency: v.currency, timezone: v.timezone })
      .returning();
    const user = await createAdmin(tx as never, ws.id, v.email, v.password, v.name);
    return { ws, user };
  });
  if (v.demo === "on") {
    try {
      await seedDemo(db, ws.id);
    } catch (err) {
      log.error("demo seed failed", err);
    }
  }
  await startSession(user.id, ws.id);
  redirect("/");
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
  const r = await login(email, password, ip);
  if (!r.ok) return { error: r.error, values: { email } };
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
