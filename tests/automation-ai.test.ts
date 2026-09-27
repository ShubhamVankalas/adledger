import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  alertWindow,
  alertsView,
  anomalyRule,
  evaluateAnomalyRule,
  evaluateRule,
  measure,
  parseAlertRuleInput,
  runAlerts,
  thresholdInput,
  zScore,
  type AlertRule,
} from "@/lib/alerts";
import { answerQuestion, askHistory, planQuestion, runAskTool, sortRows } from "@/lib/ai/ask";
import { formatCell } from "@/lib/ai/ask-format";
import { sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { digestCadence, digestPeriod } from "@/lib/notify";
import { roleCan } from "@/lib/permissions";
import { overview, performance, platforms } from "@/lib/reports";
import { actionCards, segmentsText, weeklyAmount } from "@/lib/reports-insights";
import { saveConnection, type Workspace } from "@/lib/settings";
import { createShareLink, describeShareFilters, findActiveShare, loadSharedReport, normalizeShareFilters, revokeShareLink, shareStatus, truncateIp } from "@/lib/share";
import { setupWorkspace } from "./helpers";

let db: DB;
let ws: Workspace;
let other: Workspace;

// Demo data ends on 2026-09-01; "now" is the next day, so alert windows end on the last day with data.
const NOW = new Date("2026-09-02T10:00:00Z");
const HOUR = 3_600_000;

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
  const [ws2] = await db
    .insert(schema.workspaces)
    .values({ organizationId: ws.organizationId, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" })
    .returning();
  other = ws2;
});

afterEach(() => vi.unstubAllGlobals());

function stubSlack() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response("ok", { status: 200 });
    }),
  );
  return calls;
}

async function insertRule(values: Partial<typeof schema.alertRules.$inferInsert>): Promise<AlertRule> {
  const [row] = await db
    .insert(schema.alertRules)
    .values({ workspaceId: ws.id, name: "Test rule", metric: "cac", comparator: "gt", thresholdMinor: 100, windowDays: 2, channels: ["notify_slack"], ...values })
    .returning();
  return row;
}
const reload = async (id: string) => (await db.select().from(schema.alertRules).where(eq(schema.alertRules.id, id)))[0];

describe("alert rule input", () => {
  it("stores money thresholds as minor units and ratios as decimals", () => {
    const money = parseAlertRuleInput({ metric: "cac", comparator: "gt", threshold: "1,250.5", windowDays: "2", scope: "workspace", cooldownHours: "24" }, "USD", []);
    expect(money).toMatchObject({ metric: "cac", thresholdMinor: 125050, thresholdValue: null, windowDays: 2, scope: "workspace", scopeId: null });
    expect(money.name).toBe("CAC above $1,251");
    const inr = parseAlertRuleInput({ metric: "spend", threshold: "800", windowDays: "1", cooldownHours: "24" }, "INR", []);
    expect(inr.thresholdMinor).toBe(80000);
    const jpy = parseAlertRuleInput({ metric: "spend", threshold: "800", windowDays: "1", cooldownHours: "24" }, "JPY", []);
    expect(jpy.thresholdMinor).toBe(800);
    const ratio = parseAlertRuleInput({ metric: "roas", comparator: "lt", threshold: "1.5x", windowDays: "3", cooldownHours: "48" }, "USD", []);
    expect(ratio).toMatchObject({ comparator: "lt", thresholdMinor: null, thresholdValue: "1.5000", cooldownHours: 48 });
    expect(thresholdInput({ metric: "cac", thresholdMinor: 125050, thresholdValue: null }, "USD")).toBe("1250.5");
    expect(thresholdInput({ metric: "roas", thresholdMinor: null, thresholdValue: "1.5000" }, "USD")).toBe("1.5");
  });

  it("rejects bad input with a message the form can show", () => {
    const base = { metric: "cac", threshold: "80", windowDays: "2", cooldownHours: "24" };
    expect(() => parseAlertRuleInput({ ...base, metric: "mer" }, "USD", [])).toThrow(/metric/);
    expect(() => parseAlertRuleInput({ ...base, threshold: "-5" }, "USD", [])).toThrow(/threshold/);
    expect(() => parseAlertRuleInput({ ...base, threshold: "abc" }, "USD", [])).toThrow(/threshold/);
    expect(() => parseAlertRuleInput({ ...base, windowDays: "5" }, "USD", [])).toThrow(/days/);
    expect(() => parseAlertRuleInput({ ...base, scope: "platform", scopeId: "myspace" }, "USD", [])).toThrow(/platform/);
    expect(() => parseAlertRuleInput({ ...base, scope: "campaign", scopeId: "1; drop table" }, "USD", [])).toThrow(/campaign/);
  });

  it("keeps only channels the workspace has connected", () => {
    const r = parseAlertRuleInput({ metric: "cac", threshold: "80", windowDays: "2", cooldownHours: "24", channels: ["notify_slack", "notify_evil", "notify_slack"] }, "USD", ["notify_slack"]);
    expect(r.channels).toEqual(["notify_slack"]);
  });
});

describe("alert evaluation", () => {
  it("measures with the same SQL as the dashboard", async () => {
    const period = alertWindow(ws, 2, NOW);
    expect(period).toEqual({ start: "2026-08-31", end: "2026-09-01" });
    const o = await overview(db, ws, { ...period, model: "linear" });
    expect(await measure(db, ws, { metric: "cac", scope: "workspace", scopeId: null }, period)).toBe(o.cacMinor);
    expect(await measure(db, ws, { metric: "spend", scope: "workspace", scopeId: null }, period)).toBe(o.spendMinor);
    const meta = await overview(db, ws, { ...period, model: "linear", platform: "meta" });
    expect(await measure(db, ws, { metric: "revenue", scope: "platform", scopeId: "meta" }, period)).toBe(meta.attributedRevenueMinor);
    const [camp] = await performance(db, ws, { ...period, model: "linear", level: "campaign" });
    expect(await measure(db, ws, { metric: "roas", scope: "campaign", scopeId: camp.id }, period)).toBe(camp.roas);
  });

  it("“CAC above X for 2 days” fires once through the channel, then waits for recovery and the cooldown", async () => {
    await saveConnection(ws.id, "notify_slack", { mode: "live", secrets: { webhookUrl: "https://hooks.slack.com/services/T/B/X" } }, db);
    const calls = stubSlack();
    const rule = await insertRule({ name: "CAC watch", thresholdMinor: 100, cooldownHours: 24 });

    const first = await evaluateRule(db, ws, rule, NOW);
    expect(first).toMatchObject({ breached: true, fired: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("CAC watch");

    // Still breached an hour later: no second message.
    const again = await evaluateRule(db, ws, await reload(rule.id), new Date(NOW.getTime() + HOUR));
    expect(again).toMatchObject({ breached: true, fired: false });
    expect(calls).toHaveLength(1);

    // Recovers (threshold raised), then breaches again inside the cooldown: logged as resolved, but quiet.
    await db.update(schema.alertRules).set({ thresholdMinor: 1e12 }).where(eq(schema.alertRules.id, rule.id));
    expect(await evaluateRule(db, ws, await reload(rule.id), new Date(NOW.getTime() + 2 * HOUR))).toMatchObject({ resolved: true });
    await db.update(schema.alertRules).set({ thresholdMinor: 100 }).where(eq(schema.alertRules.id, rule.id));
    expect(await evaluateRule(db, ws, await reload(rule.id), new Date(NOW.getTime() + 3 * HOUR))).toMatchObject({ breached: true, fired: false });
    expect(calls).toHaveLength(1);

    // After the cooldown it may notify again.
    expect(await evaluateRule(db, ws, await reload(rule.id), new Date(NOW.getTime() + 25 * HOUR))).toMatchObject({ fired: true });
    expect(calls).toHaveLength(2);

    const events = await db.select().from(schema.alertEvents).where(eq(schema.alertEvents.ruleId, rule.id));
    expect(events.map((e) => e.status).sort()).toEqual(["resolved", "triggered", "triggered"]);
    expect(events.filter((e) => e.status === "triggered").every((e) => e.delivered.includes("notify_slack"))).toBe(true);
    await db.delete(schema.alertRules).where(eq(schema.alertRules.id, rule.id));
  });

  it("does not fire when the metric can't be measured, and ignores other workspaces' rules", async () => {
    const calls = stubSlack();
    // No spend or customers in the other workspace: CAC is null, so nothing fires.
    const [r] = await db.insert(schema.alertRules).values({ workspaceId: other.id, name: "Empty", metric: "cac", thresholdMinor: 1, windowDays: 2, channels: [] }).returning();
    expect(await evaluateRule(db, other, r, NOW)).toMatchObject({ value: null, breached: false, fired: false });
    expect(await runAlerts(db, other, NOW)).toBe(0);
    expect(calls).toHaveLength(0);
    const view = await alertsView(db, ws);
    expect(view.rules.some((x) => x.id === r.id)).toBe(false);
  });

  it("z-score needs enough history and some variation", () => {
    expect(zScore([5, 5, 5])).toBeNull();
    const flat = Array.from({ length: 28 }, () => 100);
    expect(zScore([...flat, 500])).toBeNull(); // no variation
    const history = Array.from({ length: 28 }, (_, i) => 100 + (i % 2 ? 10 : -10));
    const z = zScore([...history, 200])!;
    expect(z.mean).toBe(100);
    expect(z.z).toBeGreaterThan(9);
    expect(zScore([...Array.from({ length: 20 }, () => 0), 10, 20, 30, 40])).toBeNull(); // too few active days
  });

  it("the anomaly rule reports each metric at most once per day", async () => {
    const calls = stubSlack();
    const rule = await anomalyRule(db, ws.id);
    expect(rule).toMatchObject({ kind: "anomaly", enabled: false });
    expect((await anomalyRule(db, ws.id)).id).toBe(rule.id); // one per workspace
    // A tiny z threshold makes any normal day "unusual", so the rule definitely fires.
    await db.update(schema.alertRules).set({ enabled: true, thresholdValue: "0.0001", channels: ["notify_slack"] }).where(eq(schema.alertRules.id, rule.id));
    const fired = await evaluateAnomalyRule(db, ws, await reload(rule.id), NOW);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((a) => a.date === "2026-09-01")).toBe(true);
    expect(calls).toHaveLength(fired.length);
    expect(await evaluateAnomalyRule(db, ws, await reload(rule.id), new Date(NOW.getTime() + HOUR))).toHaveLength(0);
    expect(calls).toHaveLength(fired.length);
    await db.update(schema.alertRules).set({ enabled: false }).where(eq(schema.alertRules.id, rule.id));
  });
});

describe("scheduled digests", () => {
  it("covers yesterday, last week on Mondays and last month on the 1st", () => {
    expect(digestCadence({})).toBe("daily");
    expect(digestCadence({ cadence: "monthly" })).toBe("monthly");
    expect(digestCadence({ cadence: "hourly" })).toBe("daily");
    expect(digestPeriod("daily", { date: "2026-09-02", weekday: "Wed" })).toEqual({ start: "2026-09-01", end: "2026-09-01", title: "Yesterday" });
    expect(digestPeriod("weekly", { date: "2026-09-02", weekday: "Wed" })).toBeNull();
    expect(digestPeriod("weekly", { date: "2026-09-07", weekday: "Mon" })).toEqual({ start: "2026-08-31", end: "2026-09-06", title: "Last week" });
    expect(digestPeriod("monthly", { date: "2026-09-02", weekday: "Wed" })).toBeNull();
    expect(digestPeriod("monthly", { date: "2026-03-01", weekday: "Sun" })).toEqual({ start: "2026-02-01", end: "2026-02-28", title: "Last month" });
  });
});

describe("share links", () => {
  it("stores only the token's hash", async () => {
    const { token, link } = await createShareLink(db, { workspaceId: ws.id, userId: null, label: "Client", filters: normalizeShareFilters({ range: "30d" }), expiresInDays: 30 });
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(link.tokenHash).toBe(sha256(token));
    expect(link.tokenHash).not.toContain(token);
    expect((await findActiveShare(db, token))?.link.id).toBe(link.id);
    expect(await findActiveShare(db, "not a token")).toBeNull();
    expect(await findActiveShare(db, `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`)).toBeNull();
  });

  it("URL parameters can't widen or change a locked link", async () => {
    const filters = normalizeShareFilters({ start: "2026-08-03", end: "2026-09-01", model: "linear", platform: "meta" });
    expect(describeShareFilters(filters)).toBe("Aug 3 – Sep 1, 2026 · Linear attribution · Meta only");
    const { token } = await createShareLink(db, { workspaceId: ws.id, userId: null, label: "Meta only", filters, expiresInDays: 30 });
    const plain = await loadSharedReport(token, {}, { db });
    const tampered = await loadSharedReport(token, { platform: "google", from: "2025-01-01", to: "2026-12-31", range: "90d", model: "first_touch", level: "ad" }, { db });
    expect(plain).not.toBeNull();
    expect(tampered!.ignoredParams.sort()).toEqual(["from", "level", "model", "platform", "range", "to"]);
    const a = { ...plain!, ignoredParams: [] };
    expect({ ...tampered!, ignoredParams: [] }).toEqual(a);
    // Only Meta's numbers: its spend, the revenue credited to it, its campaigns; no platform table.
    const meta = await overview(db, ws, { start: "2026-08-03", end: "2026-09-01", model: "linear", platform: "meta" });
    expect(a.current).toMatchObject({ spendMinor: meta.spendMinor, revenueMinor: meta.attributedRevenueMinor, leads: meta.paidLeads });
    expect(a.campaigns.length).toBeGreaterThan(0);
    expect(a.campaigns.every((c) => c.platform === "meta")).toBe(true);
    expect(a.platforms).toEqual([]);
    expect(a.series.reduce((s, d) => s + d.spendMinor, 0)).toBe(meta.spendMinor);
  });

  it("shows aggregates only: no contacts, emails or ids", async () => {
    const { token } = await createShareLink(db, { workspaceId: ws.id, userId: null, label: "All", filters: normalizeShareFilters({ range: "30d" }), expiresInDays: 7 });
    const r = await loadSharedReport(token, {}, { db });
    const json = JSON.stringify({ ...r, link: { ...r!.link, id: "x" }, workspace: { ...r!.workspace, id: "x", organizationId: "x" } });
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const all = await platforms(db, ws, { start: r!.period.start, end: r!.period.end, model: "linear" });
    expect(r!.platforms.map((p) => p.platform)).toEqual(all.map((p) => p.platform));
  });

  it("expired and revoked links stop working; revoking needs the right workspace", async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    const expired = await createShareLink(db, { workspaceId: ws.id, userId: null, label: "Old", filters: normalizeShareFilters({}), expiresInDays: 1 }, past);
    expect(shareStatus(expired.link)).toBe("expired");
    expect(await loadSharedReport(expired.token, {}, { db })).toBeNull();

    const live = await createShareLink(db, { workspaceId: ws.id, userId: null, label: "Live", filters: normalizeShareFilters({}), expiresInDays: 30 });
    expect(await revokeShareLink(db, other.id, live.link.id)).toBeNull();
    expect(await loadSharedReport(live.token, {}, { db })).not.toBeNull();
    const revoked = await revokeShareLink(db, ws.id, live.link.id);
    expect(shareStatus(revoked!)).toBe("revoked");
    expect(await loadSharedReport(live.token, {}, { db })).toBeNull();
    // Revoking again keeps the first time.
    const again = await revokeShareLink(db, ws.id, live.link.id, new Date(Date.now() + 86_400_000));
    expect(again!.revokedAt!.getTime()).toBe(revoked!.revokedAt!.getTime());
  });

  it("a link from one workspace never shows another's numbers", async () => {
    const { token } = await createShareLink(db, { workspaceId: other.id, userId: null, label: "Other", filters: normalizeShareFilters({ start: "2026-08-03", end: "2026-09-01" }), expiresInDays: 30 });
    const r = await loadSharedReport(token, {}, { db });
    expect(r!.workspace.name).toBe("Other");
    expect(r!.current).toMatchObject({ spendMinor: 0, revenueMinor: 0 });
    expect(r!.campaigns).toEqual([]);
  });

  it("validates the create form", () => {
    expect(normalizeShareFilters({ range: "12y", model: "nope" })).toEqual({ range: "30d", model: "linear" });
    expect(() => normalizeShareFilters({ platform: "myspace" })).toThrow();
    expect(() => normalizeShareFilters({ start: "2026-09-01", end: "2026-08-01" })).toThrow();
    expect(() => normalizeShareFilters({ start: "2024-01-01", end: "2026-01-01" })).toThrow(/400 days/);
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0");
    expect(truncateIp("::ffff:10.1.2.3")).toBe("10.1.2.0");
    expect(truncateIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3::");
  });
});

describe("Ask", () => {
  const P30 = { start: "2026-08-03", end: "2026-09-01", model: "linear" as const };

  it("routes common questions to the right tool without a model", () => {
    expect(planQuestion("top campaign by ROAS last 30d")).toEqual({ tool: "get_performance", args: { range: "30d", sort_by: "roas", order: "desc", limit: 10 } });
    expect(planQuestion("Which Meta ad sets have the cheapest CAC this week?")).toMatchObject({ tool: "get_performance", args: { platform: "meta", level: "ad_group", sort_by: "cac", order: "asc", range: "7d" } });
    expect(planQuestion("Where am I wasting money?").tool).toBe("find_wasted_spend");
    expect(planQuestion("How does this compare with the previous period?").tool).toBe("compare_periods");
    expect(planQuestion("Meta or Google?").tool).toBe("get_platform_breakdown");
    expect(planQuestion("How are we doing?").tool).toBe("get_overview");
  });

  it("“top campaign by ROAS last 30d” returns the Performance numbers exactly", async () => {
    const answer = await answerQuestion(db, ws, "top campaign by ROAS last 30d");
    expect(answer.modelName).toBe("rules");
    const [table] = answer.tables;
    expect(table.source).toBe("/performance?from=2026-08-03&to=2026-09-01&model=linear");
    const perf = await performance(db, ws, { ...P30, level: "campaign" });
    const expected = sortRows(perf, "roas", "desc").slice(0, 10);
    expect(table.rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(table.rows.map((r) => r.roas)).toEqual(expected.map((r) => r.roas));
    expect(table.rows.map((r) => r.spend)).toEqual(expected.map((r) => r.spendMinor));
    const best = Math.max(...perf.filter((r) => r.roas !== null).map((r) => r.roas!));
    expect(table.rows[0].roas).toBe(best);
    expect(answer.content).toContain(formatCell("ratio", best, "USD"));
    expect(answer.content).toContain(String(table.rows[0].name));
  });

  it("uses the model to pick tools, and flags any number it makes up", async () => {
    const perf = sortRows(await performance(db, ws, { ...P30, level: "campaign" }), "roas", "desc");
    const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: "tool-call", toolCallId: "c1", toolName: "get_performance", input: JSON.stringify({ range: "30d", sort_by: "roas", limit: 3 }) }],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: `${perf[0].name} leads with ${formatCell("ratio", perf[0].roas, "USD")} ROAS. It also made $987,654 last year.` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ] as never,
    });
    const answer = await answerQuestion(db, ws, "best ROAS campaign?", { model, modelName: "mock/test" });
    expect(answer.modelName).toBe("mock/test");
    expect(answer.tables).toHaveLength(1);
    expect(answer.tables[0].rows.map((r) => r.id)).toEqual(perf.slice(0, 3).map((r) => r.id));
    expect(answer.unverifiedNumbers).toEqual(["987,654"]);
    // The model saw formatted values only, never raw minor units.
    const toolResult = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(toolResult).toContain(formatCell("money", perf[0].spendMinor, "USD"));
  });

  it("falls back to a direct lookup when the model fails", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("connection refused");
      },
    });
    const answer = await answerQuestion(db, ws, "Where am I wasting money?", { model, modelName: "mock/broken" });
    expect(answer.error).toMatch(/connection refused/);
    expect(answer.tables[0].title).toBe("Campaigns with ROAS under 0.5×");
  });

  it("tools only read this workspace", async () => {
    const t = await runAskTool(db, other, "get_performance", { start: P30.start, end: P30.end });
    expect(t.rows).toEqual([]);
    const s = await runAskTool(db, other, "search_campaigns", { query: "brand" });
    expect(s.rows).toEqual([]);
  });

  it("keeps history per user", async () => {
    const [u1] = await db.insert(schema.users).values({ email: `a-${Date.now()}@example.com`, passwordHash: "x" }).returning();
    const [u2] = await db.insert(schema.users).values({ email: `b-${Date.now()}@example.com`, passwordHash: "x" }).returning();
    await db.insert(schema.askMessages).values([
      { workspaceId: ws.id, userId: u1.id, role: "user", content: "hello" },
      { workspaceId: ws.id, userId: u2.id, role: "user", content: "other person" },
    ]);
    expect((await askHistory(db, ws.id, u1.id)).map((m) => m.content)).toEqual(["hello"]);
    expect(await askHistory(db, other.id, u1.id)).toEqual([]);
    // A question and its answer stamped in the same millisecond still read in order.
    const at = new Date(Date.now() + 60_000);
    await db.insert(schema.askMessages).values([
      { workspaceId: ws.id, userId: u2.id, role: "assistant", content: "answer", createdAt: at },
      { workspaceId: ws.id, userId: u2.id, role: "user", content: "question", createdAt: at },
    ]);
    expect((await askHistory(db, ws.id, u2.id)).slice(-2).map((m) => m.content)).toEqual(["question", "answer"]);
  });
});

describe("action cards", () => {
  it("builds read-only recommendations whose chips point at real rows", async () => {
    const { period, cards } = await actionCards(db, ws, { start: "2026-08-03", end: "2026-09-01", model: "linear" });
    expect(period.end).toBe("2026-09-01");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
    const ids = new Set((await performance(db, ws, { ...period, level: "campaign" })).map((r) => r.id));
    for (const c of cards) {
      for (const id of c.campaignIds) expect(ids.has(id)).toBe(true);
      const chips = [...c.title, ...c.evidence].filter((s) => typeof s !== "string");
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) expect(chip.href).toMatch(/^\/(performance|settings|\?)|^\/\?/);
      expect(segmentsText(c.title)).not.toMatch(/NaN|undefined|Infinity/);
    }
    // The demo has a clear money-loser, so the first card moves budget away from it.
    const shift = cards.find((c) => c.kind === "shift" || c.kind === "cut");
    expect(shift).toBeDefined();
    const perf = await performance(db, ws, { ...period, level: "campaign" });
    const worst = perf.find((r) => r.id === shift!.campaignIds[0])!;
    expect(worst.roas === null || worst.roas < 0.5).toBe(true);
  });

  it("an empty workspace gets no cards", async () => {
    expect((await actionCards(db, other)).cards).toEqual([]);
  });

  it("rounds the weekly amount to a friendly figure", () => {
    expect(weeklyAmount(1_121_700, 30)).toBe(260_000);
    expect(weeklyAmount(40_000, 30)).toBe(9_300);
    expect(weeklyAmount(1000, 30)).toBe(200);
    expect(weeklyAmount(0, 30)).toBe(100);
  });
});

describe("permissions", () => {
  it("alerts and sharing are for owners, admins and analysts; Ask also for viewers", () => {
    for (const p of ["alerts.manage", "reports.share"] as const) {
      expect(["owner", "admin", "analyst"].every((r) => roleCan(r as never, p))).toBe(true);
      expect(roleCan("viewer", p)).toBe(false);
      expect(roleCan("client", p)).toBe(false);
    }
    expect(roleCan("viewer", "insights.ask")).toBe(true);
    expect(roleCan("client", "insights.ask")).toBe(false);
  });

  it("every new table is scoped to a workspace", async () => {
    const rows = await db.select().from(schema.shareLinks).where(and(eq(schema.shareLinks.workspaceId, ws.id)));
    expect(rows.every((r) => r.workspaceId === ws.id)).toBe(true);
  });
});
