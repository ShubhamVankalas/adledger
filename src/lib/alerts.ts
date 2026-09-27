import { and, desc, eq } from "drizzle-orm";
import type { NotificationMessage } from "./connectors/types";
import { getDb, schema, type DB } from "./db";
import type { AlertComparator, AlertMetric, AlertScope } from "./db/schema";
import { credit, longDate, moneyWhole, platformLabel, roas as roasX, signedPct } from "./format";
import { log } from "./log";
import { appUrl, sendToChannel } from "./notify";
import { overview, performance, timeseries, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Alert rules (Insights → Alerts). Numbers come from lib/reports (SQL) like every other screen.
//
// Threshold rules compare one metric, aggregated over the last N complete days in the workspace
// timezone, against a threshold. A rule notifies once per breach: when the metric crosses the
// threshold it sends, then stays quiet until the metric recovers. After a recovery it can fire
// again, but never sooner than `cooldown_hours` after the previous notification.
//
// The built-in anomaly rule (kind = "anomaly") flags a day whose revenue, spend or leads sit more
// than `threshold_value` standard deviations from the previous `window_days` days.

export type AlertRule = typeof schema.alertRules.$inferSelect;
export type AlertEvent = typeof schema.alertEvents.$inferSelect;
export type MetricUnit = "money" | "ratio" | "count";

export const ALERT_METRICS: { id: AlertMetric; label: string; unit: MetricUnit; description: string }[] = [
  { id: "cac", label: "CAC", unit: "money", description: "Ad spend per customer won from ads" },
  { id: "cpl", label: "CPL", unit: "money", description: "Ad spend per lead from ads" },
  { id: "roas", label: "ROAS", unit: "ratio", description: "Revenue credited to ads ÷ ad spend" },
  { id: "spend", label: "Ad spend", unit: "money", description: "Total ad spend" },
  { id: "revenue", label: "Revenue", unit: "money", description: "Revenue (credited to ads when scoped to a platform or campaign)" },
  { id: "leads", label: "Leads", unit: "count", description: "New leads (from ads when scoped to a platform or campaign)" },
];
export const ALERT_METRIC_IDS = ALERT_METRICS.map((m) => m.id) as [AlertMetric, ...AlertMetric[]];
export const metricDef = (id: string) => ALERT_METRICS.find((m) => m.id === id) ?? ALERT_METRICS[0];

export const ANOMALY_METRICS = ["revenue", "spend", "leads"] as const;
export type AnomalyMetric = (typeof ANOMALY_METRICS)[number];
/** Sensitivity presets for the anomaly rule (z-score threshold). */
export const ANOMALY_SENSITIVITY = [
  { z: 2.5, label: "High", description: "More alerts, including smaller swings" },
  { z: 3, label: "Medium", description: "Clear outliers only (recommended)" },
  { z: 4, label: "Low", description: "Only extreme days" },
] as const;
export const ANOMALY_LOOKBACK_DAYS = 28;
/** Days of history with activity needed before the anomaly rule speaks up. */
export const ANOMALY_MIN_ACTIVE_DAYS = 14;

/** The attribution model alerts use (the dashboard default). */
const MODEL = "linear" as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shiftDays = (date: string, days: number) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);

/** The last `days` complete days in the workspace timezone (ending yesterday). */
export function alertWindow(ws: Pick<Workspace, "timezone">, days: number, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ws.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const end = shiftDays(today, -1);
  return { start: shiftDays(end, -(Math.max(1, days) - 1)), end };
}

// ---------------------------------------------------------------- formatting

export function formatMetric(metric: string, value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const unit = metricDef(metric).unit;
  if (unit === "money") return moneyWhole(Math.round(value), currency);
  if (unit === "ratio") return roasX(value);
  return credit(value);
}

/** The rule's threshold in the metric's natural unit (minor units for money). */
export function ruleThreshold(rule: Pick<AlertRule, "metric" | "thresholdMinor" | "thresholdValue">): number | null {
  if (metricDef(rule.metric).unit === "money") return rule.thresholdMinor ?? null;
  return rule.thresholdValue === null ? null : Number(rule.thresholdValue);
}

export function windowLabel(days: number) {
  return days === 1 ? "yesterday" : `over the last ${days} days`;
}

/** "CAC above $80 over the last 2 days" (+ scope label separately). */
export function describeRule(rule: Pick<AlertRule, "metric" | "comparator" | "thresholdMinor" | "thresholdValue" | "windowDays">, currency: string) {
  const def = metricDef(rule.metric);
  return `${def.label} ${rule.comparator === "gt" ? "above" : "below"} ${formatMetric(rule.metric, ruleThreshold(rule), currency)} ${windowLabel(rule.windowDays)}`;
}

export function scopeLabel(rule: Pick<AlertRule, "scope" | "scopeId">, campaignName?: string | null) {
  if (rule.scope === "platform") return platformLabel(rule.scopeId);
  if (rule.scope === "campaign") return campaignName ?? "Deleted campaign";
  return "Whole workspace";
}

// ---------------------------------------------------------------- measuring

/** One metric for one scope and period, straight from reports.ts. null = not measurable (e.g. CAC with no customers). */
export async function measure(
  db: DB,
  ws: Workspace,
  q: { metric: AlertMetric; scope: AlertScope; scopeId: string | null },
  period: { start: string; end: string },
): Promise<number | null> {
  const p: ReportParams = { ...period, model: MODEL };
  if (q.scope === "campaign") {
    if (!q.scopeId) return null;
    const row = (await performance(db, ws, { ...p, level: "campaign" })).find((r) => r.id === q.scopeId);
    const values: Record<AlertMetric, number | null> = {
      cac: row?.cacMinor ?? null,
      cpl: row?.cplMinor ?? null,
      roas: row?.roas ?? null,
      spend: row?.spendMinor ?? 0,
      revenue: row?.revenueMinor ?? 0,
      leads: row?.leads ?? 0,
    };
    return values[q.metric];
  }
  const scoped = q.scope === "platform" && q.scopeId;
  const o = await overview(db, ws, scoped ? { ...p, platform: q.scopeId as ReportParams["platform"] } : p);
  const values: Record<AlertMetric, number | null> = {
    cac: o.cacMinor,
    cpl: o.cplMinor,
    roas: o.roas,
    spend: o.spendMinor,
    // Scoped to a platform, only the revenue and leads credited to it count.
    revenue: scoped ? o.attributedRevenueMinor : o.revenueMinor,
    leads: scoped ? o.paidLeads : o.leads,
  };
  return values[q.metric];
}

export function isBreached(value: number | null, comparator: AlertComparator, threshold: number | null) {
  if (value === null || threshold === null) return false;
  return comparator === "gt" ? value > threshold : value < threshold;
}

// ---------------------------------------------------------------- delivery

async function deliver(db: DB, ws: Workspace, channels: string[], msg: NotificationMessage): Promise<string[]> {
  const delivered: string[] = [];
  for (const channel of channels) {
    try {
      await sendToChannel(db, ws.id, channel, msg);
      delivered.push(channel);
    } catch (err) {
      log.warn(`alert via ${channel} failed`, err);
    }
  }
  return delivered;
}

async function campaignName(db: DB, ws: Workspace, id: string | null) {
  if (!id) return null;
  const [c] = await db
    .select({ name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.workspaceId, ws.id), eq(schema.campaigns.id, id)));
  return c?.name ?? null;
}

// ---------------------------------------------------------------- threshold rules

export type Evaluation = { value: number | null; breached: boolean; fired: boolean; resolved: boolean; period: { start: string; end: string } };

/** Evaluate one threshold rule and notify when it newly breaches. */
export async function evaluateRule(db: DB, ws: Workspace, rule: AlertRule, now = new Date()): Promise<Evaluation> {
  const period = alertWindow(ws, rule.windowDays, now);
  const value = await measure(db, ws, { metric: rule.metric as AlertMetric, scope: rule.scope, scopeId: rule.scopeId }, period);
  const threshold = ruleThreshold(rule);
  const breached = isBreached(value, rule.comparator, threshold);
  const cooledDown = !rule.lastTriggeredAt || now.getTime() - rule.lastTriggeredAt.getTime() >= rule.cooldownHours * HOUR_MS;
  const fire = breached && rule.state === "ok" && cooledDown;
  const resolved = !breached && rule.state === "breached" && value !== null;
  const scope = scopeLabel(rule, rule.scope === "campaign" ? await campaignName(db, ws, rule.scopeId) : null);
  const valueText = formatMetric(rule.metric, value, ws.reportingCurrency);
  const range = period.start === period.end ? longDate(period.end) : `${longDate(period.start)} – ${longDate(period.end)}`;

  if (fire) {
    const def = metricDef(rule.metric);
    const title = `${rule.name}: ${def.label} is ${valueText}`;
    const msg: NotificationMessage = {
      title,
      text: `**${def.label}** was **${valueText}** ${windowLabel(rule.windowDays)} (${range}), ${rule.comparator === "gt" ? "above" : "below"} your threshold of ${formatMetric(rule.metric, threshold, ws.reportingCurrency)}.`,
      severity: "warning",
      url: appUrl("/insights?tab=alerts"),
      fields: [
        { label: "Rule", value: describeRule(rule, ws.reportingCurrency) },
        { label: "Scope", value: scope },
        { label: "Workspace", value: ws.name },
      ],
    };
    const delivered = await deliver(db, ws, rule.channels, msg);
    await db.insert(schema.alertEvents).values({
      workspaceId: ws.id,
      ruleId: rule.id,
      kind: "threshold",
      status: "triggered",
      metric: rule.metric,
      title,
      detail: `${describeRule(rule, ws.reportingCurrency)} · ${scope}`,
      value: value === null ? null : String(value),
      periodStart: period.start,
      periodEnd: period.end,
      delivered,
    });
  } else if (resolved) {
    await db.insert(schema.alertEvents).values({
      workspaceId: ws.id,
      ruleId: rule.id,
      kind: "threshold",
      status: "resolved",
      metric: rule.metric,
      title: `${rule.name}: back to normal at ${valueText}`,
      detail: `${describeRule(rule, ws.reportingCurrency)} · ${scope}`,
      value: value === null ? null : String(value),
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  await db
    .update(schema.alertRules)
    .set({
      // A breach held back by the cooldown stays "ok" so it can still notify once the cooldown ends.
      state: fire ? "breached" : resolved ? "ok" : rule.state,
      lastValue: value === null ? null : String(value),
      lastEvaluatedAt: now,
      ...(fire ? { lastTriggeredAt: now } : {}),
    })
    .where(eq(schema.alertRules.id, rule.id));
  return { value, breached, fired: fire, resolved, period };
}

// ---------------------------------------------------------------- anomalies

export type Anomaly = { metric: AnomalyMetric; date: string; value: number; mean: number; sd: number; z: number };

/**
 * z-score of the last day of `series` against the days before it. Needs at least
 * ANOMALY_MIN_ACTIVE_DAYS of non-zero history and some variation; otherwise null.
 */
export function zScore(series: number[]): { value: number; mean: number; sd: number; z: number } | null {
  if (series.length < 3) return null;
  const value = series[series.length - 1];
  const base = series.slice(0, -1);
  if (base.filter((v) => v !== 0).length < ANOMALY_MIN_ACTIVE_DAYS) return null;
  const mean = base.reduce((s, v) => s + v, 0) / base.length;
  const variance = base.reduce((s, v) => s + (v - mean) ** 2, 0) / (base.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return { value, mean, sd, z: (value - mean) / sd };
}

/** Anomalies on yesterday's revenue, spend and leads (no side effects). */
export async function findAnomalies(db: DB, ws: Workspace, zThreshold: number, lookbackDays = ANOMALY_LOOKBACK_DAYS, now = new Date()): Promise<Anomaly[]> {
  const { start, end } = alertWindow(ws, lookbackDays + 1, now);
  const series = await timeseries(db, ws, { start, end, model: MODEL });
  const pick: Record<AnomalyMetric, (p: (typeof series)[number]) => number> = {
    revenue: (p) => p.revenueMinor,
    spend: (p) => p.spendMinor,
    leads: (p) => p.leads,
  };
  const out: Anomaly[] = [];
  for (const metric of ANOMALY_METRICS) {
    const z = zScore(series.map(pick[metric]));
    if (z && Math.abs(z.z) >= zThreshold) out.push({ metric, date: end, ...z });
  }
  return out;
}

const ANOMALY_LABEL: Record<AnomalyMetric, string> = { revenue: "Revenue", spend: "Ad spend", leads: "Leads" };

function anomalyMessage(a: Anomaly, ws: Workspace, lookbackDays: number): NotificationMessage & { detail: string } {
  const label = ANOMALY_LABEL[a.metric];
  const fmt = (v: number) => (a.metric === "leads" ? credit(v) : moneyWhole(Math.round(v), ws.reportingCurrency));
  const up = a.z > 0;
  const change = a.mean > 0 ? signedPct((a.value - a.mean) / a.mean) : null;
  // Rising revenue or leads is good news; a spend spike or a revenue/lead drop needs a look.
  const good = a.metric !== "spend" && up;
  const detail = `${fmt(a.value)} on ${longDate(a.date)} vs a ${lookbackDays}-day average of ${fmt(a.mean)}${change ? ` (${change})` : ""}`;
  return {
    title: `${label} was unusually ${up ? "high" : "low"} on ${longDate(a.date)}`,
    text: `**${label}** was **${fmt(a.value)}** on ${longDate(a.date)}, against a typical ${fmt(a.mean)} a day over the previous ${lookbackDays} days. That is ${Math.abs(a.z).toFixed(1)} standard deviations ${up ? "above" : "below"} normal.`,
    severity: good ? "success" : "warning",
    url: appUrl("/insights?tab=alerts"),
    fields: [
      { label: longDate(a.date), value: fmt(a.value) },
      { label: `${lookbackDays}-day average`, value: fmt(a.mean) },
      ...(change ? [{ label: "Difference", value: change }] : []),
    ],
    detail,
  };
}

/** Run the anomaly rule: one event (and one notification) per metric per day, at most. */
export async function evaluateAnomalyRule(db: DB, ws: Workspace, rule: AlertRule, now = new Date()) {
  const z = rule.thresholdValue === null ? 3 : Number(rule.thresholdValue);
  const lookback = Math.min(90, Math.max(7, rule.windowDays || ANOMALY_LOOKBACK_DAYS));
  const found = await findAnomalies(db, ws, z, lookback, now);
  const fired: Anomaly[] = [];
  if (found.length) {
    const already = await db
      .select({ metric: schema.alertEvents.metric, periodEnd: schema.alertEvents.periodEnd })
      .from(schema.alertEvents)
      .where(and(eq(schema.alertEvents.workspaceId, ws.id), eq(schema.alertEvents.ruleId, rule.id), eq(schema.alertEvents.periodEnd, found[0].date)));
    for (const a of found) {
      if (already.some((e) => e.metric === a.metric)) continue;
      const { detail, ...msg } = anomalyMessage(a, ws, lookback);
      const delivered = await deliver(db, ws, rule.channels, msg);
      await db.insert(schema.alertEvents).values({
        workspaceId: ws.id,
        ruleId: rule.id,
        kind: "anomaly",
        status: "triggered",
        metric: a.metric,
        title: msg.title,
        detail,
        value: String(a.value),
        periodStart: a.date,
        periodEnd: a.date,
        delivered,
      });
      fired.push(a);
    }
  }
  await db
    .update(schema.alertRules)
    .set({ lastEvaluatedAt: now, ...(fired.length ? { lastTriggeredAt: now, state: "breached" as const } : { state: "ok" as const }) })
    .where(eq(schema.alertRules.id, rule.id));
  return fired;
}

// ---------------------------------------------------------------- runners

/** Evaluate every enabled rule of one workspace. Never throws (one broken rule must not stop the rest). */
export async function runAlerts(db: DB, ws: Workspace, now = new Date()) {
  const rules = await db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.workspaceId, ws.id), eq(schema.alertRules.enabled, true)));
  let fired = 0;
  for (const rule of rules) {
    try {
      if (rule.kind === "anomaly") fired += (await evaluateAnomalyRule(db, ws, rule, now)).length;
      else if ((await evaluateRule(db, ws, rule, now)).fired) fired++;
    } catch (err) {
      log.warn(`alert rule ${rule.id} failed`, err);
    }
  }
  return fired;
}

/** Scheduler entry point (see jobs.ts): every workspace, once an hour. */
export async function runAlertsAll(now = new Date()) {
  const db = await getDb();
  for (const ws of await db.select().from(schema.workspaces)) await runAlerts(db, ws, now);
}

/** Latest alert history for a workspace (Insights → Alerts, Settings → Alerts). */
export async function recentAlertEvents(db: DB, workspaceId: string, limit = 30) {
  return db
    .select()
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.workspaceId, workspaceId))
    .orderBy(desc(schema.alertEvents.createdAt))
    .limit(limit);
}
