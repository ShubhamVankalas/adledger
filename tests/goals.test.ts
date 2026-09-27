import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { overview } from "@/lib/reports";
import {
  computePace,
  getTargets,
  goalsPacing,
  parseGoalInput,
  periodBounds,
  periodClock,
  stoplight,
  targetFor,
  upsertGoal,
  deleteGoal,
  listGoals,
} from "@/lib/reports-goals";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { saveGoalAction, deleteGoalAction } = await import("@/app/actions/goals");

let db: DB;
let ws: Workspace;
let other: Workspace;
let orgId: string;

// Demo data runs up to 2026-09-14; "now" is the 15th at 12:00 UTC, so September is 14.5 days in.
const NOW = new Date("2026-09-15T12:00:00Z");

async function member(role: "owner" | "admin" | "analyst" | "viewer") {
  const [user] = await db.insert(schema.users).values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: ws.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  await seedDemo(db, ws.id, { anchor: "2026-09-14" });
  const [o] = await db.insert(schema.workspaces).values({ organizationId: org.id, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  other = o as Workspace;
}, 300_000);

describe("goal input parsing", () => {
  it("parses money, counts and ratios the way people type them", () => {
    expect(parseGoalInput({ metric: "revenue", period: "month", target: "$50,000", budget: "15 000" }, "USD")).toEqual({
      metric: "revenue",
      period: "month",
      targetMinor: 5_000_000,
      targetValue: null,
      budgetMinor: 1_500_000,
    });
    expect(parseGoalInput({ metric: "roas", period: "quarter", target: "3.5x" }, "USD")).toMatchObject({ period: "quarter", targetValue: "3.5000", targetMinor: null, budgetMinor: null });
    expect(parseGoalInput({ metric: "leads", period: "nonsense", target: "120" }, "USD")).toMatchObject({ period: "month", targetValue: "120" });
    expect(parseGoalInput({ metric: "cpl", period: "month", target: "4500" }, "JPY").targetMinor).toBe(4500);
  });

  it("rejects bad input with a message a person can act on", () => {
    expect(() => parseGoalInput({ metric: "profit", period: "month", target: "1" }, "USD")).toThrow(/Pick a metric/);
    expect(() => parseGoalInput({ metric: "revenue", period: "month", target: "0" }, "USD")).toThrow(/above zero/);
    expect(() => parseGoalInput({ metric: "revenue", period: "month", target: "abc" }, "USD")).toThrow(/above zero/);
    expect(() => parseGoalInput({ metric: "leads", period: "month", target: "12.5" }, "USD")).toThrow(/whole number/);
    expect(() => parseGoalInput({ metric: "roas", period: "month", target: "5000" }, "USD")).toThrow(/ratio/);
    expect(() => parseGoalInput({ metric: "revenue", period: "month", target: "10", budget: "lots" }, "USD")).toThrow(/budget/);
  });
});

describe("period calendar", () => {
  it("finds month and quarter bounds, including leap years", () => {
    expect(periodBounds("month", "2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29", days: 29 });
    expect(periodBounds("month", "2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31", days: 31 });
    expect(periodBounds("quarter", "2026-08-20")).toEqual({ start: "2026-07-01", end: "2026-09-30", days: 92 });
    expect(periodBounds("quarter", "2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-12-31", days: 92 });
  });

  it("measures elapsed days in the workspace timezone", () => {
    // 2026-09-30 20:00 UTC is already 1 October in Kolkata (UTC+5:30): a new month has started.
    const utc = periodClock("month", new Date("2026-09-30T20:00:00Z"), "UTC");
    expect(utc).toMatchObject({ start: "2026-09-01", today: "2026-09-30", daysTotal: 30 });
    expect(utc.daysElapsed).toBeCloseTo(29 + 20 / 24, 6);
    const ist = periodClock("month", new Date("2026-09-30T20:00:00Z"), "Asia/Kolkata");
    expect(ist).toMatchObject({ start: "2026-10-01", today: "2026-10-01", daysTotal: 31 });
    expect(ist.daysElapsed).toBeCloseTo(1.5 / 24, 6);
  });
});

describe("pace arithmetic", () => {
  const clock = { start: "2026-09-01", end: "2026-09-30", daysElapsed: 15, daysTotal: 30 };

  it("projects a cumulative goal to the end of the period at the current run rate", () => {
    const p = computePace({ id: "g", metric: "revenue", period: "month", target: 100_000, actual: 45_000, budgetMinor: null, spentMinor: 0, clock });
    expect(p.expectedToDate).toBe(50_000);
    expect(p.projected).toBe(90_000);
    expect(p.progress).toBeCloseTo(0.45);
    expect(p.projectedProgress).toBeCloseTo(0.9);
    expect(p.status).toBe("at_risk"); // 90% is inside the 10% amber band
    expect(computePace({ id: "g", metric: "revenue", period: "month", target: 100_000, actual: 50_000, budgetMinor: null, spentMinor: 0, clock }).status).toBe("on_pace");
    expect(computePace({ id: "g", metric: "revenue", period: "month", target: 100_000, actual: 40_000, budgetMinor: null, spentMinor: 0, clock }).status).toBe("behind");
  });

  it("marks a reached target as achieved and waits three days before judging", () => {
    const done = computePace({ id: "g", metric: "leads", period: "month", target: 100, actual: 120, budgetMinor: null, spentMinor: 0, clock });
    expect(done).toMatchObject({ achieved: true, status: "on_pace" });
    const early = computePace({ id: "g", metric: "leads", period: "month", target: 100, actual: 1, budgetMinor: null, spentMinor: 0, clock: { ...clock, daysElapsed: 2 } });
    expect(early.status).toBe("early");
  });

  it("judges ratio and cost goals on the value to date, honouring direction", () => {
    const roas = computePace({ id: "g", metric: "roas", period: "month", target: 3, actual: 2.8, budgetMinor: null, spentMinor: 0, clock });
    expect(roas).toMatchObject({ projected: 2.8, expectedToDate: null, status: "at_risk", achieved: false });
    const cac = computePace({ id: "g", metric: "cac", period: "month", target: 5_000, actual: 4_000, budgetMinor: null, spentMinor: 0, clock });
    expect(cac).toMatchObject({ status: "on_pace", achieved: true });
    const noSpend = computePace({ id: "g", metric: "cpl", period: "month", target: 5_000, actual: null, budgetMinor: null, spentMinor: 0, clock });
    expect(noSpend.status).toBe("no_data");
  });

  it("paces the ad budget", () => {
    const base = { id: "g", metric: "revenue" as const, period: "month" as const, target: 1, actual: 1, clock };
    expect(computePace({ ...base, budgetMinor: 10_000, spentMinor: 5_000 }).budget).toMatchObject({ projectedMinor: 10_000, status: "on_track", progress: 0.5 });
    expect(computePace({ ...base, budgetMinor: 10_000, spentMinor: 6_000 }).budget?.status).toBe("over");
    expect(computePace({ ...base, budgetMinor: 10_000, spentMinor: 3_000 }).budget?.status).toBe("under");
    expect(computePace({ ...base, budgetMinor: 10_000, spentMinor: 11_000 }).budget?.status).toBe("over");
  });

  it("colours stoplights by direction with an amber band", () => {
    expect(stoplight("roas", 3.2, 3)).toBe("good");
    expect(stoplight("roas", 2.8, 3)).toBe("warn");
    expect(stoplight("roas", 2, 3)).toBe("bad");
    expect(stoplight("cpl", 900, 1000)).toBe("good");
    expect(stoplight("cpl", 1050, 1000)).toBe("warn");
    expect(stoplight("cpl", 1500, 1000)).toBe("bad");
    expect(stoplight("roas", null, 3)).toBeNull();
    expect(stoplight("roas", 2, null)).toBeNull();
    expect(targetFor({ roas: 3 }, "roas")).toBe(3);
    expect(targetFor({ roas: 3 }, "cpl")).toBeNull();
  });
});

describe("goals on demo data", () => {
  it("paces every goal against the same numbers overview() reports", async () => {
    await upsertGoal(db, ws, parseGoalInput({ metric: "revenue", period: "month", target: "20000", budget: "8000" }, "USD"));
    await upsertGoal(db, ws, parseGoalInput({ metric: "roas", period: "month", target: "2.5" }, "USD"));
    await upsertGoal(db, ws, parseGoalInput({ metric: "leads", period: "quarter", target: "900" }, "USD"));
    const pacing = await goalsPacing(db, ws, { now: NOW, model: "linear" });
    const month = await overview(db, ws, { start: "2026-09-01", end: "2026-09-15", model: "linear" });
    const quarter = await overview(db, ws, { start: "2026-07-01", end: "2026-09-15", model: "linear" });
    expect(month.revenueMinor).toBeGreaterThan(0);

    const by = Object.fromEntries(pacing.items.map((i) => [i.metric, i]));
    expect(pacing.items.map((i) => i.metric)).toEqual(["revenue", "leads", "roas"]); // display order
    expect(by.revenue.actual).toBe(month.revenueMinor);
    expect(by.revenue.daysElapsed).toBe(14.5);
    expect(by.revenue.projected).toBe(Math.round((month.revenueMinor / 14.5) * 30));
    expect(by.revenue.budget).toMatchObject({ budgetMinor: 800_000, spentMinor: month.spendMinor });
    expect(by.roas.actual).toBeCloseTo(month.roas!, 10);
    expect(by.leads).toMatchObject({ period: "quarter", start: "2026-07-01", end: "2026-09-30", actual: quarter.leads });
  });

  it("replaces a metric's goal instead of adding a second one", async () => {
    await upsertGoal(db, ws, parseGoalInput({ metric: "revenue", period: "quarter", target: "90000" }, "USD"));
    const goals = await listGoals(db, ws);
    const revenue = goals.filter((g) => g.metric === "revenue");
    expect(revenue).toHaveLength(1);
    expect(revenue[0]).toMatchObject({ period: "quarter", targetMinor: 9_000_000, budgetMinor: null });
    expect(await getTargets(db, ws)).toEqual({ revenue: 9_000_000, roas: 2.5, leads: 900 });
  });

  it("keeps workspaces apart", async () => {
    await upsertGoal(db, other, parseGoalInput({ metric: "cpl", period: "month", target: "12" }, "USD"));
    expect((await listGoals(db, ws)).map((g) => g.metric)).not.toContain("cpl");
    expect(await getTargets(db, other)).toEqual({ cpl: 1200 });
    const [foreign] = await listGoals(db, other);
    expect(await deleteGoal(db, ws, foreign.id)).toBeNull(); // can't delete another workspace's goal
    expect(await listGoals(db, other)).toHaveLength(1);
    expect((await goalsPacing(db, other, { now: NOW })).items[0]).toMatchObject({ metric: "cpl", actual: null, status: "no_data" });
  });

  it("hides money goals set in an old reporting currency", async () => {
    const eur = { ...ws, reportingCurrency: "EUR" };
    const pacing = await goalsPacing(db, eur, { now: NOW });
    expect(pacing.items.map((i) => i.metric)).toEqual(["leads", "roas"]);
    expect(pacing.skipped).toEqual([expect.objectContaining({ metric: "revenue" })]);
    expect(await getTargets(db, eur)).toEqual({ roas: 2.5, leads: 900 });
  });
});

describe("goal actions", () => {
  it("lets owners and admins save and remove targets, with an audit trail", async () => {
    session.token = await member("admin");
    const saved = await saveGoalAction(form({ metric: "customers", period: "month", target: "40", budget: "" }));
    expect(saved).toMatchObject({ ok: true });
    const [goal] = await db.select().from(schema.goals).where(and(eq(schema.goals.workspaceId, ws.id), eq(schema.goals.metric, "customers")));
    expect(goal.targetValue).toBe("40.0000");
    const bad = await saveGoalAction(form({ metric: "customers", period: "month", target: "-4" }));
    expect(bad).toMatchObject({ ok: false, message: expect.stringMatching(/above zero/) });

    expect(await deleteGoalAction("not-a-uuid")).toMatchObject({ ok: false });
    expect(await deleteGoalAction(goal.id)).toMatchObject({ ok: true });
    const trail = await db.select().from(schema.auditLog).where(eq(schema.auditLog.workspaceId, ws.id));
    expect(trail.map((a) => a.action)).toEqual(expect.arrayContaining(["goal.saved", "goal.deleted"]));
  });

  it("refuses analysts and viewers", async () => {
    for (const role of ["analyst", "viewer"] as const) {
      session.token = await member(role);
      expect(await saveGoalAction(form({ metric: "mer", period: "month", target: "4" }))).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    }
    expect(await db.select().from(schema.goals).where(and(eq(schema.goals.workspaceId, ws.id), eq(schema.goals.metric, "mer")))).toHaveLength(0);
    session.token = undefined;
  });
});
