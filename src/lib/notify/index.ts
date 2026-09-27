import { and, eq } from "drizzle-orm";
import { getNotificationDriver } from "../connectors/registry";
import type { NotificationMessage } from "../connectors/types";
import { getDb, schema, type DB } from "../db";
import type { NotificationEvent } from "../db/schema";
import { log } from "../log";
import { formatMoney } from "../money";
import { overview, wastedSpend } from "../reports";
import { getConnection, type Workspace } from "../settings";

// Delivers workspace events (weekly report, alerts…) to the channels the team configured
// in Settings → Notifications. Never throws: a broken Slack webhook must not break a sync.

export const EVENTS: { event: NotificationEvent; label: string; description: string; defaults: Record<string, string | number> }[] = [
  { event: "weekly_report", label: "Weekly report", description: "The AI (or rule-based) weekly note every Monday morning.", defaults: {} },
  { event: "daily_digest", label: "Daily digest", description: "Yesterday's spend, revenue, ROAS, leads and customers.", defaults: { hour: 8 } },
  { event: "wasted_spend", label: "Wasted spend alert", description: "Daily check: campaigns over a spend threshold with ROAS below 0.5x in the last 7 days.", defaults: { hour: 9, minSpend: 100 } },
  { event: "sync_failed", label: "Sync failed", description: "An ad platform or payment sync returned an error.", defaults: {} },
  { event: "new_customer", label: "New customer", description: "Someone paid for the first time, with the ad that brought them.", defaults: {} },
  { event: "big_payment", label: "Large payment", description: "A single payment at or above a threshold.", defaults: { threshold: 1000 } },
  {
    event: "security_alert",
    label: "Security alert",
    description: "A new API key, a role change, two-factor sign-in turned off, a bulk export, a contact erasure or a sign-in from a new device.",
    defaults: {},
  },
];

export function appUrl(path: string) {
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
}

/** Send one message through one configured channel (used by rules and the “Send test” button). */
export async function sendToChannel(db: DB, workspaceId: string, channel: string, msg: NotificationMessage) {
  const driver = getNotificationDriver(channel.replace(/^notify_/, ""));
  if (!driver) throw new Error(`Unknown channel ${channel}`);
  const conn = await getConnection(workspaceId, channel, db);
  if (!conn || !conn.enabled) throw new Error("This channel isn't set up yet.");
  await driver.send({ config: conn.config, secrets: conn.secrets }, msg);
}

/** Deliver an event to every enabled rule for it. `filter` can skip rules (e.g. thresholds). */
export async function notify(
  workspaceId: string,
  event: NotificationEvent,
  build: (settings: Record<string, string | number>) => NotificationMessage | null,
  db?: DB,
) {
  try {
    const d = db ?? (await getDb());
    const rules = await d
      .select()
      .from(schema.notificationRules)
      .where(and(eq(schema.notificationRules.workspaceId, workspaceId), eq(schema.notificationRules.event, event), eq(schema.notificationRules.enabled, true)));
    for (const rule of rules) {
      const msg = build(rule.settings);
      if (!msg) continue;
      try {
        await sendToChannel(d, workspaceId, rule.channel, msg);
        await d.update(schema.notificationRules).set({ lastSentAt: new Date() }).where(eq(schema.notificationRules.id, rule.id));
      } catch (err) {
        log.warn(`notification ${event} via ${rule.channel} failed`, err);
      }
    }
  } catch (err) {
    log.warn(`notification ${event} failed`, err);
  }
}

/** Fire-and-forget variant for request paths (webhooks, collect). */
export function notifyLater(...args: Parameters<typeof notify>) {
  if (process.env.ADLEDGER_SYNC_JOBS === "1") return notify(...args);
  void notify(...args);
}

// ---- scheduled events (called hourly by the scheduler)

function localParts(tz: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: parts.weekday as string };
}

const yesterdayOf = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

async function dueRules(db: DB, ws: Workspace, event: NotificationEvent, now: Date) {
  const local = localParts(ws.timezone, now);
  const rules = await db
    .select()
    .from(schema.notificationRules)
    .where(and(eq(schema.notificationRules.workspaceId, ws.id), eq(schema.notificationRules.event, event), eq(schema.notificationRules.enabled, true)));
  return rules.filter((r) => {
    const hour = Number(r.settings.hour ?? EVENTS.find((e) => e.event === event)?.defaults.hour ?? 8);
    const sentToday = r.lastSentAt && localParts(ws.timezone, r.lastSentAt).date === local.date;
    return local.hour >= hour && !sentToday;
  });
}

export async function runScheduledNotifications(db: DB, ws: Workspace, now = new Date()) {
  const local = localParts(ws.timezone, now);
  const money = (m: number | null) => (m === null ? "—" : formatMoney(m, ws.reportingCurrency));
  const x = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}x`);

  for (const rule of await dueRules(db, ws, "daily_digest", now)) {
    const day = yesterdayOf(local.date);
    const o = await overview(db, ws, { start: day, end: day, model: "linear" });
    const msg: NotificationMessage = {
      title: `Yesterday in ${ws.name}: ${money(o.revenueMinor)} revenue`,
      text: `Here's ${day} at a glance (linear attribution).`,
      severity: "info",
      url: appUrl(`/?range=7d`),
      fields: [
        { label: "Ad spend", value: money(o.spendMinor) },
        { label: "Revenue", value: money(o.revenueMinor) },
        { label: "ROAS", value: x(o.roas) },
        { label: "Leads", value: String(o.leads) },
        { label: "Customers", value: String(o.customers) },
      ],
    };
    await deliver(db, ws.id, rule, now, msg);
  }

  for (const rule of await dueRules(db, ws, "wasted_spend", now)) {
    const end = yesterdayOf(local.date);
    const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    const minSpendMinor = Math.round(Number(rule.settings.minSpend ?? 100) * 100);
    const waste = await wastedSpend(db, ws, { start, end, model: "linear", minSpendMinor });
    if (waste.length === 0) {
      await db.update(schema.notificationRules).set({ lastSentAt: now }).where(eq(schema.notificationRules.id, rule.id));
      continue;
    }
    const total = waste.reduce((s, w) => s + w.spendMinor, 0);
    await deliver(db, ws.id, rule, now, {
      title: `${money(total)} of ad spend returned almost nothing last week`,
      text: `These campaigns spent at least ${money(minSpendMinor)} from ${start} to ${end} with ROAS under 0.5x:\n${waste
        .slice(0, 6)
        .map((w) => `- **${w.name}** (${w.platform}): ${money(w.spendMinor)} spent, ${money(w.revenueMinor)} revenue, ROAS ${x(w.roas)}`)
        .join("\n")}`,
      severity: "warning",
      url: appUrl("/performance?range=7d"),
    });
  }
}

async function deliver(db: DB, workspaceId: string, rule: typeof schema.notificationRules.$inferSelect, now: Date, msg: NotificationMessage) {
  try {
    await sendToChannel(db, workspaceId, rule.channel, msg);
  } catch (err) {
    log.warn(`scheduled ${rule.event} via ${rule.channel} failed`, err);
  }
  await db.update(schema.notificationRules).set({ lastSentAt: now }).where(eq(schema.notificationRules.id, rule.id));
}
