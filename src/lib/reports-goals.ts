import { and, asc, eq } from "drizzle-orm";
import { schema, type DB } from "./db";
import type { AttributionModel, GoalMetric, GoalPeriod } from "./db/schema";
import { computePace, GOAL_METRIC_KEYS, GOAL_METRICS, goalTarget, periodClock, type Goal, type GoalInput, type GoalPacing, type GoalsPacing, type PeriodClock, type Targets } from "./goal-metrics";
import { overview, type Overview } from "./reports";
import type { Workspace } from "./settings";

export * from "./goal-metrics";

// Goals & targets: what the workspace is aiming for, and whether the current month or quarter
// is on pace. Actuals come from overview() in reports.ts (SQL), so a goal always shows the same
// number as the matching KPI tile. Definitions and pace arithmetic live in goal-metrics.ts.

/** The period-to-date value of a metric, read from an overview() result. */
export function metricActual(metric: GoalMetric, o: Overview): number | null {
  switch (metric) {
    case "revenue":
      return o.revenueMinor;
    case "attributed_revenue":
      return o.attributedRevenueMinor;
    case "leads":
      return o.leads;
    case "customers":
      return o.customers;
    case "roas":
      return o.roas;
    case "mer":
      return o.blendedRoas;
    case "cac":
      return o.cacMinor;
    case "cpl":
      return o.cplMinor;
  }
}

// ---------------------------------------------------------------- queries

export async function listGoals(db: DB, ws: Pick<Workspace, "id">): Promise<Goal[]> {
  const list = await db.select().from(schema.goals).where(eq(schema.goals.workspaceId, ws.id)).orderBy(asc(schema.goals.createdAt));
  return list.sort((a, b) => GOAL_METRIC_KEYS.indexOf(a.metric) - GOAL_METRIC_KEYS.indexOf(b.metric));
}

/**
 * Workspace targets keyed by metric, in natural units (minor units for money). Money targets set
 * in another currency are left out: they no longer mean anything after a currency change.
 */
export async function getTargets(db: DB, ws: Pick<Workspace, "id" | "reportingCurrency">): Promise<Targets> {
  const out: Targets = {};
  for (const g of await listGoals(db, ws)) {
    if (GOAL_METRICS[g.metric].kind === "money" && g.currency !== ws.reportingCurrency) continue;
    const t = goalTarget(g);
    if (t !== null) out[g.metric] = t;
  }
  return out;
}

/** Pace every goal for the current month or quarter (one overview() per period in use). */
export async function goalsPacing(
  db: DB,
  ws: Workspace,
  opts: { model?: AttributionModel; now?: Date } = {},
): Promise<GoalsPacing> {
  const model = opts.model ?? "linear";
  const now = opts.now ?? new Date();
  const goals = await listGoals(db, ws);
  const clocks = new Map<GoalPeriod, PeriodClock>();
  const actuals = new Map<GoalPeriod, Overview>();
  for (const period of new Set(goals.map((g) => g.period))) {
    const clock = periodClock(period, now, ws.timezone);
    clocks.set(period, clock);
    actuals.set(period, await overview(db, ws, { start: clock.start, end: clock.today, model }));
  }

  const items: GoalPacing[] = [];
  const skipped: GoalsPacing["skipped"] = [];
  for (const g of goals) {
    const def = GOAL_METRICS[g.metric];
    const target = goalTarget(g);
    if (target === null) continue;
    if ((def.kind === "money" || g.budgetMinor) && g.currency !== ws.reportingCurrency) {
      skipped.push({ id: g.id, metric: g.metric, reason: `Set in ${g.currency}; the workspace now reports in ${ws.reportingCurrency}. Edit the goal to update it.` });
      continue;
    }
    const clock = clocks.get(g.period)!;
    const o = actuals.get(g.period)!;
    items.push(
      computePace({ id: g.id, metric: g.metric, period: g.period, target, actual: metricActual(g.metric, o), budgetMinor: g.budgetMinor, spentMinor: o.spendMinor, clock }),
    );
  }
  return { currency: ws.reportingCurrency, model, today: clocks.values().next().value?.today ?? periodClock("month", now, ws.timezone).today, items, skipped };
}

/** Insert or replace the goal for a metric (one goal per metric per workspace). */
export async function upsertGoal(db: DB, ws: Pick<Workspace, "id" | "reportingCurrency">, input: GoalInput): Promise<Goal> {
  const values = { ...input, currency: ws.reportingCurrency, updatedAt: new Date() };
  const [row] = await db
    .insert(schema.goals)
    .values({ workspaceId: ws.id, ...values })
    .onConflictDoUpdate({ target: [schema.goals.workspaceId, schema.goals.metric], set: values })
    .returning();
  return row;
}

export async function deleteGoal(db: DB, ws: Pick<Workspace, "id">, id: string): Promise<Goal | null> {
  const [row] = await db
    .delete(schema.goals)
    .where(and(eq(schema.goals.id, id), eq(schema.goals.workspaceId, ws.id)))
    .returning();
  return row ?? null;
}
