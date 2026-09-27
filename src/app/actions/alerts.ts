"use server";

import { and, eq, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  ANOMALY_SENSITIVITY,
  alertWindow,
  anomalyRule,
  describeRule,
  formatMetric,
  isBreached,
  measure,
  parseAlertRuleInput,
  ruleThreshold,
  windowLabel,
  type AlertRuleInput,
} from "@/lib/alerts";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema, type DB } from "@/lib/db";

// Settings → Alerts. Every action checks `alerts.manage` and writes the audit log.

const PATHS = ["/settings/workspace/alerts", "/insights"];
const refresh = () => PATHS.forEach((p) => revalidatePath(p));

async function connectedChannels(db: DB, workspaceId: string) {
  const rows = await db
    .select({ provider: schema.connections.provider })
    .from(schema.connections)
    .where(and(eq(schema.connections.workspaceId, workspaceId), like(schema.connections.provider, "notify_%"), eq(schema.connections.enabled, true)));
  return rows.map((r) => r.provider as string);
}

async function readRuleForm(db: DB, user: Awaited<ReturnType<typeof guard>>, form: FormData): Promise<AlertRuleInput> {
  const input = parseAlertRuleInput(
    {
      name: str(form, "name"),
      metric: str(form, "metric"),
      comparator: str(form, "comparator"),
      threshold: str(form, "threshold"),
      windowDays: str(form, "windowDays"),
      scope: str(form, "scope"),
      scopeId: str(form, "scope") === "platform" ? str(form, "platform") : str(form, "campaign"),
      channels: form.getAll("channels").map(String),
      cooldownHours: str(form, "cooldownHours"),
      enabled: form.get("enabled") !== "off",
    },
    user.workspace.reportingCurrency,
    await connectedChannels(db, user.workspace.id),
  );
  if (input.scope === "campaign") {
    const [c] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.workspaceId, user.workspace.id), eq(schema.campaigns.id, input.scopeId!)));
    if (!c) throw new Error("That campaign isn't in this workspace.");
  }
  return input;
}

/** Create (no `id`) or update a threshold rule. Editing a rule re-arms it. */
export async function saveAlertRuleAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("alerts.manage");
    const db = await getDb();
    const input = await readRuleForm(db, user, form);
    const id = str(form, "id");
    if (id) {
      const [row] = await db
        .update(schema.alertRules)
        .set({ ...input, state: "ok", lastValue: null })
        .where(and(eq(schema.alertRules.workspaceId, user.workspace.id), eq(schema.alertRules.id, id), eq(schema.alertRules.kind, "threshold")))
        .returning({ id: schema.alertRules.id });
      if (!row) return fail("That alert no longer exists.");
      await audit(user, "alert_rule.update", row.id, { metric: input.metric, scope: input.scope });
    } else {
      const count = await db.$count(schema.alertRules, eq(schema.alertRules.workspaceId, user.workspace.id));
      if (count >= 50) return fail("A workspace can have up to 50 alerts. Delete one you no longer need first.");
      const [row] = await db
        .insert(schema.alertRules)
        .values({ ...input, workspaceId: user.workspace.id, kind: "threshold", createdBy: user.id })
        .returning({ id: schema.alertRules.id });
      await audit(user, "alert_rule.create", row.id, { metric: input.metric, scope: input.scope });
    }
    refresh();
    return ok(id ? "Alert updated." : input.channels.length ? "Alert created." : "Alert created. Pick a channel so it can reach you.");
  });
}

export async function setAlertRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("alerts.manage");
    const db = await getDb();
    const [row] = await db
      .update(schema.alertRules)
      .set({ enabled, ...(enabled ? { state: "ok" as const } : {}) })
      .where(and(eq(schema.alertRules.workspaceId, user.workspace.id), eq(schema.alertRules.id, id)))
      .returning({ id: schema.alertRules.id, name: schema.alertRules.name });
    if (!row) return fail("That alert no longer exists.");
    await audit(user, enabled ? "alert_rule.enable" : "alert_rule.disable", row.id);
    refresh();
    return ok(enabled ? `“${row.name}” is on.` : `“${row.name}” is paused.`);
  });
}

export async function deleteAlertRuleAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("alerts.manage");
    const db = await getDb();
    const [row] = await db
      .delete(schema.alertRules)
      .where(and(eq(schema.alertRules.workspaceId, user.workspace.id), eq(schema.alertRules.id, id), eq(schema.alertRules.kind, "threshold")))
      .returning({ id: schema.alertRules.id, name: schema.alertRules.name });
    if (!row) return fail("That alert no longer exists.");
    await audit(user, "alert_rule.delete", row.id);
    refresh();
    return ok(`Deleted “${row.name}”. Its history stays in the feed.`);
  });
}

/** The built-in anomaly rule: on/off, sensitivity and channels. */
export async function saveAnomalyRuleAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("alerts.manage");
    const db = await getDb();
    const rule = await anomalyRule(db, user.workspace.id);
    const z = Number(str(form, "sensitivity"));
    if (!ANOMALY_SENSITIVITY.some((s) => s.z === z)) return fail("Choose a sensitivity.");
    const available = await connectedChannels(db, user.workspace.id);
    const channels = [...new Set(form.getAll("channels").map(String))].filter((c) => available.includes(c));
    const enabled = form.get("enabled") === "on";
    await db
      .update(schema.alertRules)
      .set({ enabled, thresholdValue: String(z), channels })
      .where(eq(schema.alertRules.id, rule.id));
    await audit(user, "alert_rule.anomaly", rule.id, { enabled, z, channels: channels.length });
    refresh();
    return ok(enabled ? "Anomaly alerts are on." : "Anomaly alerts are off.");
  });
}

/** Live preview for the rule form: today's value of the metric and whether the rule would fire. Sends nothing. */
export async function previewAlertRuleAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("alerts.manage");
    const db = await getDb();
    const input = await readRuleForm(db, user, form);
    const ws = user.workspace;
    const period = alertWindow(ws, input.windowDays);
    const value = await measure(db, ws, { metric: input.metric, scope: input.scope, scopeId: input.scopeId }, period);
    const threshold = ruleThreshold(input);
    const breached = isBreached(value, input.comparator, threshold);
    return ok(undefined, {
      value: formatMetric(input.metric, value, ws.reportingCurrency),
      measurable: value !== null,
      breached,
      window: windowLabel(input.windowDays),
      rule: describeRule(input, ws.reportingCurrency),
    });
  });
}
