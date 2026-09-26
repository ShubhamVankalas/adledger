"use server";

import { generateText } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { generateReport, getLlmConfig, languageModel, LLM_PROVIDERS } from "@/lib/ai/report";
import { recomputeAttribution } from "@/lib/attribution";
import { audit, createApiKey } from "@/lib/auth";
import { getIntegration } from "@/lib/connectors/registry";
import { ensureStripeWebhook } from "@/lib/connectors/stripe";
import { checkOutboundUrl } from "@/lib/net";
import { publicUrl } from "@/lib/url";
import { randomToken } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { clearWorkspaceData, seedDemo } from "@/lib/demo/seed";
import { deleteConnection, saveConnection } from "@/lib/settings";
import { syncProvider } from "@/lib/sync";

// Workspace-level settings. Every action checks the caller's role.

// ---------------------------------------------------------------- AI insights

export async function generateReportAction(): Promise<ActionResult> {
  return run(async () => {
    const { workspace } = await guard("insights.generate");
    const db = await getDb();
    const { report, error } = await generateReport(db, workspace);
    revalidatePath("/insights");
    revalidatePath("/");
    if (error) return ok(`The model call failed (${error.slice(0, 160)}), so a rule-based report was generated instead.`, { id: report.id });
    return ok(report.modelName === "template" ? "Report generated (rule-based — add an AI model in Settings for richer insights)." : `Report generated with ${report.modelName}.`, { id: report.id });
  });
}

export async function deleteReportAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const { workspace } = await guard("insights.generate");
    const db = await getDb();
    await db.delete(schema.aiReports).where(and(eq(schema.aiReports.id, id), eq(schema.aiReports.workspaceId, workspace.id)));
    revalidatePath("/insights");
    return ok("Report deleted.");
  });
}

// ---------------------------------------------------------------- tracking

export async function createPixelSiteAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const name = str(form, "name") || "My website";
    const db = await getDb();
    await db.insert(schema.pixelSites).values({ workspaceId: user.workspace.id, name: name.slice(0, 80), domains: str(form, "domains").slice(0, 500), publicKey: `pk_${randomToken(12)}` });
    await audit(user, "pixel_site.created", name);
    revalidatePath("/settings", "layout");
    return ok("Website added. Copy the snippet into your site's <head>.");
  });
}

export async function updatePixelSiteAction(id: string, domains: string): Promise<ActionResult> {
  return run(async () => {
    const { workspace } = await guard("workspace.settings");
    const db = await getDb();
    await db.update(schema.pixelSites).set({ domains: domains.slice(0, 500) }).where(and(eq(schema.pixelSites.id, id), eq(schema.pixelSites.workspaceId, workspace.id)));
    revalidatePath("/settings", "layout");
    return ok("Allowed domains saved.");
  });
}

export async function deletePixelSiteAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    await db.delete(schema.pixelSites).where(and(eq(schema.pixelSites.id, id), eq(schema.pixelSites.workspaceId, user.workspace.id)));
    await audit(user, "pixel_site.deleted", id);
    revalidatePath("/settings", "layout");
    return ok("Website removed. Existing data is kept.");
  });
}

export async function createLeadWebhookAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const name = str(form, "name") || "Lead form";
    const db = await getDb();
    await db.insert(schema.leadWebhooks).values({ workspaceId: user.workspace.id, name: name.slice(0, 80), token: `lw_${randomToken(18)}`, fieldMapping: {} });
    await audit(user, "lead_webhook.created", name);
    revalidatePath("/settings", "layout");
    return ok("Webhook created. Paste the URL into your form tool.");
  });
}

export async function deleteLeadWebhookAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    await db.delete(schema.leadWebhooks).where(and(eq(schema.leadWebhooks.id, id), eq(schema.leadWebhooks.workspaceId, user.workspace.id)));
    await audit(user, "lead_webhook.deleted", id);
    revalidatePath("/settings", "layout");
    return ok("Webhook deleted.");
  });
}

// ---------------------------------------------------------------- integrations (registry-driven)

export async function saveIntegrationAction(provider: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const meta = getIntegration(provider);
    if (!meta || meta.fields.length === 0) return fail("Unknown integration.");
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const f of meta.fields) {
      const v = str(form, f.name);
      if (f.secret) secrets[f.name] = v;
      else config[f.name] = v;
    }
    const db = await getDb();
    const existing = await db
      .select({ secretsEnc: schema.connections.secretsEnc, mode: schema.connections.mode })
      .from(schema.connections)
      .where(and(eq(schema.connections.workspaceId, user.workspace.id), eq(schema.connections.provider, provider)));
    const hadSecrets = existing[0]?.mode === "live" && existing[0]?.secretsEnc;
    const missing = meta.fields.filter((f) => !f.optional && !(f.secret ? secrets[f.name] || hadSecrets : config[f.name]));
    if (missing.length) return fail(`Fill in: ${missing.map((f) => f.label).join(", ")}.`);
    const blocked = await checkIntegrationUrls(meta.fields, config, secrets);
    if (blocked) return fail(blocked);
    if (provider === "stripe" && secrets.apiKey && !/^(sk|rk)_(test|live)_/.test(secrets.apiKey)) {
      return fail("That doesn't look like a Stripe secret or restricted key (sk_… / rk_…).");
    }
    let note = "";
    // Stripe: create the webhook for the user so a single API key is all they need.
    if (provider === "stripe" && secrets.apiKey && !secrets.webhookSecret) {
      const url = `${await publicUrl()}/api/v1/webhooks/stripe/${user.workspace.id}`;
      const hook = await ensureStripeWebhook(secrets.apiKey, url);
      if ("secret" in hook) {
        secrets.webhookSecret = hook.secret;
        note = " The webhook was created in your Stripe account.";
      } else note = ` ${hook.error}`;
    }
    await saveConnection(user.workspace.id, provider, { mode: "live", enabled: true, config, secrets }, db);
    await audit(user, "integration.saved", provider);
    revalidatePath("/settings", "layout");
    if (meta.category === "notifications") return ok("Saved. Send a test message to check it.");
    // Import right away in the background; the status appears on the card.
    const wsId = user.workspace.id;
    void syncProvider(db, wsId, provider).then(() => undefined, () => undefined);
    return ok(`Connected. Importing your data now — this can take a minute.${note}`);
  });
}

/** URL / host fields (webhook URLs, store URLs, SMTP host) must not point at private networks. */
async function checkIntegrationUrls(fields: { name: string; label: string }[], config: Record<string, string>, secrets: Record<string, string>) {
  for (const f of fields) {
    const v = config[f.name] || secrets[f.name];
    if (!v) continue;
    const err = /(^url$|Url$)/.test(f.name)
      ? await checkOutboundUrl(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`)
      : /(^host$|Host$)/.test(f.name)
        ? await checkOutboundUrl(`https://${v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")}`)
        : null;
    if (err) return `${f.label}: ${err}`;
  }
  return null;
}

export async function syncNowAction(provider: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    const r = await syncProvider(db, user.workspace.id, provider, { inlineAttribution: true });
    revalidatePath("/", "layout");
    if (r.status === "error") return fail(r.error ?? "Sync failed");
    if (r.status === "skipped") return fail("Connect this account first.");
    return ok(`Synced ${r.rows.toLocaleString()} ${getIntegration(provider)?.category === "revenue" ? "payments" : "rows"}.`);
  });
}

export async function disconnectAction(provider: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    await deleteConnection(user.workspace.id, provider);
    if (provider.startsWith("notify_")) {
      const db = await getDb();
      await db.delete(schema.notificationRules).where(and(eq(schema.notificationRules.workspaceId, user.workspace.id), eq(schema.notificationRules.channel, provider)));
    }
    await audit(user, "integration.disconnected", provider);
    revalidatePath("/settings", "layout");
    return ok("Disconnected. Already-imported data is kept.");
  });
}

// ---------------------------------------------------------------- AI model

export async function saveAiAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const provider = str(form, "provider") as keyof typeof LLM_PROVIDERS;
    if (!(provider in LLM_PROVIDERS)) return fail("Pick a provider.");
    const model = str(form, "model");
    if (!model) return fail("Enter a model name.");
    const baseUrl = str(form, "baseUrl");
    if (baseUrl) {
      const err = await checkOutboundUrl(baseUrl, "llm");
      if (err) return fail(`Base URL: ${err}`);
    }
    await saveConnection(user.workspace.id, "llm", { mode: "live", enabled: true, config: { provider, model, baseUrl }, secrets: { apiKey: str(form, "apiKey") } });
    await audit(user, "ai_model.saved", `${provider}/${model}`);
    revalidatePath("/settings", "layout");
    return ok("AI model saved.");
  });
}

export async function testAiAction(): Promise<ActionResult> {
  return run(async () => {
    const { workspace } = await guard("workspace.settings");
    const cfg = await getLlmConfig(workspace);
    if (!cfg) return fail("No model configured yet.");
    try {
      const { text } = await generateText({ model: languageModel(cfg), prompt: "Reply with exactly: AdLedger OK", maxRetries: 0, timeout: { totalMs: 60_000 } });
      return ok(`${cfg.provider}/${cfg.model} replied: “${text.trim().slice(0, 80)}”`);
    } catch (err) {
      return fail(`Could not reach ${cfg.provider}/${cfg.model}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    }
  });
}

// ---------------------------------------------------------------- API keys

export async function createApiKeyAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("apikeys.manage");
    const name = str(form, "name") || "MCP";
    const { key } = await createApiKey(user.workspace.id, name);
    await audit(user, "api_key.created", name);
    revalidatePath("/settings", "layout");
    return ok("Key created. Copy it now — it won't be shown again.", { key });
  });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("apikeys.manage");
    const db = await getDb();
    await db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.workspaceId, user.workspace.id), isNull(schema.apiKeys.revokedAt)));
    await audit(user, "api_key.revoked", id);
    revalidatePath("/settings", "layout");
    return ok("Key revoked.");
  });
}

// ---------------------------------------------------------------- workspace

const wsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  reportingCurrency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(64),
  attributionWindowDays: z.coerce.number().int().min(1).max(365),
});

export async function updateWorkspaceAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const parsed = wsSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings");
    try {
      Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
    } catch {
      return fail("Unknown timezone");
    }
    const db = await getDb();
    await db.update(schema.workspaces).set(parsed.data).where(eq(schema.workspaces.id, user.workspace.id));
    if (parsed.data.attributionWindowDays !== user.workspace.attributionWindowDays) await recomputeAttribution(db, user.workspace.id);
    await audit(user, "workspace.updated", parsed.data.name);
    revalidatePath("/", "layout");
    return ok("Workspace saved.");
  });
}

export async function clearDataAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    const db = await getDb();
    await clearWorkspaceData(db, user.workspace.id);
    await audit(user, "workspace.data_cleared", user.workspace.name);
    revalidatePath("/", "layout");
    return ok("All tracked and imported data was removed. Your settings, pixel sites and API keys are kept.");
  });
}

export async function loadDemoAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    const db = await getDb();
    await clearWorkspaceData(db, user.workspace.id);
    await seedDemo(db, user.workspace.id);
    await audit(user, "workspace.demo_loaded", user.workspace.name);
    revalidatePath("/", "layout");
    return ok("Demo data loaded.");
  });
}

export async function saveOnboardingAction(patch: { platforms?: string[]; dismissed?: boolean; completed?: boolean }): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    const db = await getDb();
    // Arguments of a server action come straight from the client: keep only well-formed values.
    const platforms = Array.isArray(patch?.platforms)
      ? patch.platforms.filter((p): p is string => typeof p === "string" && /^[a-z0-9_:.-]{1,60}$/i.test(p)).slice(0, 40)
      : undefined;
    const next = {
      ...user.workspace.onboarding,
      ...(platforms ? { platforms } : {}),
      ...(typeof patch?.dismissed === "boolean" ? { dismissed: patch.dismissed } : {}),
      ...(patch?.completed === true ? { completedAt: new Date().toISOString() } : {}),
    };
    await db.update(schema.workspaces).set({ onboarding: next }).where(eq(schema.workspaces.id, user.workspace.id));
    revalidatePath("/", "layout");
    return ok();
  });
}
