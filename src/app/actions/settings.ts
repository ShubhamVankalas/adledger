"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateText } from "ai";
import { getLlmConfig, languageModel, LLM_PROVIDERS, generateReport } from "@/lib/ai/report";
import { createApiKey, requireUser } from "@/lib/auth";
import { hashPassword, randomToken, verifyPassword } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { clearWorkspaceData, seedDemo } from "@/lib/demo/seed";
import { recomputeAttribution } from "@/lib/attribution";
import { deleteConnection, saveConnection } from "@/lib/settings";
import { syncProvider } from "@/lib/sync";

export type ActionResult = { ok: boolean; message?: string; data?: Record<string, unknown> };

const ok = (message?: string, data?: Record<string, unknown>): ActionResult => ({ ok: true, message, data });
const fail = (message: string): ActionResult => ({ ok: false, message });
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------------------------------------------------------------- AI insights

export async function generateReportAction(): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  const { report, error } = await generateReport(db, workspace);
  revalidatePath("/insights");
  revalidatePath("/");
  if (error) return ok(`The model call failed (${error.slice(0, 160)}), so a rule-based report was generated instead.`, { id: report.id });
  return ok(report.modelName === "template" ? "Report generated (rule-based — add an AI model in Settings for richer insights)." : `Report generated with ${report.modelName}.`, { id: report.id });
}

export async function deleteReportAction(id: string): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await db.delete(schema.aiReports).where(and(eq(schema.aiReports.id, id), eq(schema.aiReports.workspaceId, workspace.id)));
  revalidatePath("/insights");
  return ok("Report deleted.");
}

// ---------------------------------------------------------------- tracking

export async function createPixelSiteAction(form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const name = str(form, "name") || "My website";
  const domains = str(form, "domains");
  const db = await getDb();
  await db.insert(schema.pixelSites).values({ workspaceId: workspace.id, name: name.slice(0, 80), domains: domains.slice(0, 500), publicKey: `pk_${randomToken(12)}` });
  revalidatePath("/settings");
  return ok("Website added. Copy the snippet into your site's <head>.");
}

export async function updatePixelSiteAction(id: string, domains: string): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await db
    .update(schema.pixelSites)
    .set({ domains: domains.slice(0, 500) })
    .where(and(eq(schema.pixelSites.id, id), eq(schema.pixelSites.workspaceId, workspace.id)));
  revalidatePath("/settings");
  return ok("Allowed domains saved.");
}

export async function deletePixelSiteAction(id: string): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await db.delete(schema.pixelSites).where(and(eq(schema.pixelSites.id, id), eq(schema.pixelSites.workspaceId, workspace.id)));
  revalidatePath("/settings");
  return ok("Website removed. Existing data is kept.");
}

export async function createLeadWebhookAction(form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const name = str(form, "name") || "Lead form";
  const db = await getDb();
  await db.insert(schema.leadWebhooks).values({ workspaceId: workspace.id, name: name.slice(0, 80), token: `lw_${randomToken(18)}`, fieldMapping: {} });
  revalidatePath("/settings");
  return ok("Webhook created. Paste the URL into your form tool.");
}

export async function deleteLeadWebhookAction(id: string): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await db.delete(schema.leadWebhooks).where(and(eq(schema.leadWebhooks.id, id), eq(schema.leadWebhooks.workspaceId, workspace.id)));
  revalidatePath("/settings");
  return ok("Webhook deleted.");
}

// ---------------------------------------------------------------- connections

const PROVIDER_FIELDS = {
  meta: { config: ["adAccountIds", "apiVersion"], secrets: ["accessToken"] },
  google_ads: { config: ["customerIds", "loginCustomerId", "clientId", "apiVersion"], secrets: ["developerToken", "clientSecret", "refreshToken"] },
  stripe: { config: [], secrets: ["apiKey", "webhookSecret"] },
} as const;

export async function saveConnectionAction(provider: keyof typeof PROVIDER_FIELDS, form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) return fail("Unknown provider");
  const config: Record<string, string> = {};
  for (const k of fields.config) config[k] = str(form, k);
  const secrets: Record<string, string> = {};
  for (const k of fields.secrets) secrets[k] = str(form, k);
  if (provider === "stripe" && secrets.apiKey && !/^(sk|rk)_(test|live)_/.test(secrets.apiKey)) {
    return fail("That doesn't look like a Stripe secret or restricted key (sk_… / rk_…).");
  }
  const db = await getDb();
  await saveConnection(workspace.id, provider, { mode: "live", enabled: true, config, secrets }, db);
  revalidatePath("/settings");
  return ok("Saved. Click “Sync now” to test the connection.");
}

export async function syncNowAction(provider: "meta" | "google_ads" | "stripe"): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  const r = await syncProvider(db, workspace.id, provider, { inlineAttribution: true });
  revalidatePath("/", "layout");
  if (r.status === "error") return fail(r.error ?? "Sync failed");
  if (r.status === "skipped") return fail("Connect this account first.");
  return ok(`Synced ${r.rows.toLocaleString()} ${provider === "stripe" ? "charges" : "rows"}.`);
}

export async function disconnectAction(provider: "meta" | "google_ads" | "stripe" | "llm"): Promise<ActionResult> {
  const { workspace } = await requireUser();
  await deleteConnection(workspace.id, provider);
  revalidatePath("/settings");
  return ok("Disconnected. Already-imported data is kept.");
}

// ---------------------------------------------------------------- AI model

export async function saveAiAction(form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const provider = str(form, "provider") as keyof typeof LLM_PROVIDERS;
  if (!(provider in LLM_PROVIDERS)) return fail("Pick a provider.");
  const model = str(form, "model");
  if (!model) return fail("Enter a model name.");
  const baseUrl = str(form, "baseUrl");
  await saveConnection(workspace.id, "llm", { mode: "live", enabled: true, config: { provider, model, baseUrl }, secrets: { apiKey: str(form, "apiKey") } });
  revalidatePath("/settings");
  return ok("AI model saved.");
}

export async function testAiAction(): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const cfg = await getLlmConfig(workspace);
  if (!cfg) return fail("No model configured yet.");
  try {
    const { text } = await generateText({ model: languageModel(cfg), prompt: "Reply with exactly: AdLedger OK", maxRetries: 0, timeout: { totalMs: 60_000 } });
    return ok(`${cfg.provider}/${cfg.model} replied: “${text.trim().slice(0, 80)}”`);
  } catch (err) {
    return fail(`Could not reach ${cfg.provider}/${cfg.model}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
}

// ---------------------------------------------------------------- API keys

export async function createApiKeyAction(form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const { key } = await createApiKey(workspace.id, str(form, "name") || "MCP");
  revalidatePath("/settings");
  return ok("Key created. Copy it now — it won't be shown again.", { key });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.workspaceId, workspace.id), isNull(schema.apiKeys.revokedAt)));
  revalidatePath("/settings");
  return ok("Key revoked.");
}

// ---------------------------------------------------------------- workspace

const wsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  reportingCurrency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(64),
  attributionWindowDays: z.coerce.number().int().min(1).max(365),
});

export async function updateWorkspaceAction(form: FormData): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const parsed = wsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings");
  try {
    Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return fail("Unknown timezone");
  }
  const db = await getDb();
  await db.update(schema.workspaces).set(parsed.data).where(eq(schema.workspaces.id, workspace.id));
  if (parsed.data.attributionWindowDays !== workspace.attributionWindowDays) await recomputeAttribution(db, workspace.id);
  revalidatePath("/", "layout");
  return ok("Workspace saved.");
}

export async function clearDataAction(): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await clearWorkspaceData(db, workspace.id);
  revalidatePath("/", "layout");
  return ok("All tracked and imported data was removed. Your settings, pixel sites and API keys are kept.");
}

export async function loadDemoAction(): Promise<ActionResult> {
  const { workspace } = await requireUser();
  const db = await getDb();
  await clearWorkspaceData(db, workspace.id);
  await seedDemo(db, workspace.id);
  revalidatePath("/", "layout");
  return ok("Demo data loaded.");
}

export async function changePasswordAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) return fail("New password must be at least 8 characters.");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!u || !(await verifyPassword(current, u.passwordHash))) return fail("Current password is incorrect.");
  await db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id));
  return ok("Password changed.");
}
