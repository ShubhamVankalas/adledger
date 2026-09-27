import type { AttributionModel, GoalMetric, GoalPeriod, goals as goalsTable } from "./db/schema";
import { currencyExponent, fromDecimalString } from "./money";

// Goal metric definitions, input parsing, calendar and pace arithmetic. Pure and client-safe
// (no database imports), so tables can colour stoplights in the browser too. The queries live
// in src/lib/reports-goals.ts, which re-exports everything here.

export type GoalKind = "money" | "count" | "ratio";

export type GoalMetricDef = {
  label: string;
  /** Short noun for sentences ("revenue", "ROAS"). */
  noun: string;
  kind: GoalKind;
  /** "up": more is better (revenue, ROAS). "down": less is better (CAC, CPL). */
  better: "up" | "down";
  /** Cumulative metrics add up over the period and can be projected to its end. */
  cumulative: boolean;
  help: string;
};

/** Display order is the key order. */
export const GOAL_METRICS: Record<GoalMetric, GoalMetricDef> = {
  revenue: { label: "Revenue", noun: "revenue", kind: "money", better: "up", cumulative: true, help: "Net revenue from every source after refunds, attributed or not." },
  attributed_revenue: { label: "Ad revenue", noun: "ad revenue", kind: "money", better: "up", cumulative: true, help: "Revenue credited to a paid ad under the selected attribution model." },
  leads: { label: "Leads", noun: "leads", kind: "count", better: "up", cumulative: true, help: "New leads from every source (one per person)." },
  customers: { label: "New customers", noun: "new customers", kind: "count", better: "up", cumulative: true, help: "People who paid for the first time." },
  roas: { label: "ROAS", noun: "ROAS", kind: "ratio", better: "up", cumulative: false, help: "Ad revenue ÷ ad spend, period to date." },
  mer: { label: "MER", noun: "MER", kind: "ratio", better: "up", cumulative: false, help: "All revenue ÷ ad spend (marketing efficiency ratio), period to date." },
  cac: { label: "CAC", noun: "CAC", kind: "money", better: "down", cumulative: false, help: "Ad spend ÷ customers credited to ads, period to date." },
  cpl: { label: "CPL", noun: "CPL", kind: "money", better: "down", cumulative: false, help: "Ad spend ÷ leads credited to ads, period to date." },
};
export const GOAL_METRIC_KEYS = Object.keys(GOAL_METRICS) as GoalMetric[];
export const GOAL_PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
];

export const isGoalMetric = (v: unknown): v is GoalMetric => typeof v === "string" && v in GOAL_METRICS;
export const isGoalPeriod = (v: unknown): v is GoalPeriod => v === "month" || v === "quarter";

export type Goal = typeof goalsTable.$inferSelect;

/** A goal's target in its natural unit: minor units for money, a plain number for counts and ratios. */
export function goalTarget(g: Pick<Goal, "metric" | "targetMinor" | "targetValue">): number | null {
  const def = GOAL_METRICS[g.metric];
  if (!def) return null;
  const v = def.kind === "money" ? g.targetMinor : g.targetValue === null ? null : Number(g.targetValue);
  return v === null || !Number.isFinite(v) || v <= 0 ? null : v;
}

// ---------------------------------------------------------------- input parsing

export type GoalInput = {
  metric: GoalMetric;
  period: GoalPeriod;
  targetMinor: number | null;
  targetValue: string | null;
  budgetMinor: number | null;
};

const MAX_MINOR = 1e15; // well inside bigint and JS safe integers

/** Parse a decimal a person typed ("50,000", "$1,200.50", "3.5x"). Returns null if it isn't one. */
function cleanDecimal(raw: string): string | null {
  const s = raw.trim().replace(/[\s,_]/g, "").replace(/^[^\d.-]+/, "").replace(/[x×%]$/i, "");
  return /^\d+(\.\d+)?$|^\.\d+$/.test(s) ? s : null;
}

/** Validate a goal form. Throws an Error with a message for the person when something is off. */
export function parseGoalInput(input: { metric: string; period: string; target: string; budget?: string }, currency: string): GoalInput {
  if (!isGoalMetric(input.metric)) throw new Error("Pick a metric.");
  const period: GoalPeriod = isGoalPeriod(input.period) ? input.period : "month";
  const def = GOAL_METRICS[input.metric];
  const target = cleanDecimal(input.target);
  if (!target || Number(target) <= 0) throw new Error(`Enter a ${def.noun} target above zero.`);

  let targetMinor: number | null = null;
  let targetValue: string | null = null;
  if (def.kind === "money") {
    targetMinor = fromDecimalString(target, currency);
    if (targetMinor <= 0 || targetMinor > MAX_MINOR) throw new Error(`Enter a ${def.noun} target above zero.`);
  } else if (def.kind === "count") {
    if (!/^\d+$/.test(target)) throw new Error(`${def.label} is a whole number of people. Enter a target like 120.`);
    if (Number(target) > 1e9) throw new Error("That target is too large.");
    targetValue = target;
  } else {
    if (Number(target) > 1000) throw new Error(`${def.label} is a ratio like 3.5. Enter a smaller target.`);
    targetValue = Number(target).toFixed(4);
  }

  let budgetMinor: number | null = null;
  const budgetRaw = (input.budget ?? "").trim();
  if (budgetRaw) {
    const b = cleanDecimal(budgetRaw);
    if (!b) throw new Error("Enter the ad budget as an amount, like 15000, or leave it empty.");
    budgetMinor = fromDecimalString(b, currency);
    if (budgetMinor <= 0) budgetMinor = null;
    else if (budgetMinor > MAX_MINOR) throw new Error("That budget is too large.");
  }
  return { metric: input.metric, period, targetMinor, targetValue, budgetMinor };
}

/** The value to prefill in an edit form: "50000.00" for money, "3.5" for ratios, "120" for counts. */
export function goalInputValue(g: Pick<Goal, "metric" | "targetMinor" | "targetValue" | "currency">): string {
  const def = GOAL_METRICS[g.metric];
  if (def.kind === "money") return g.targetMinor === null ? "" : minorToInput(g.targetMinor, g.currency);
  return g.targetValue === null ? "" : String(Number(g.targetValue));
}

export function minorToInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const s = (minor / 10 ** exp).toFixed(exp);
  return exp > 0 ? s.replace(/\.0+$/, "") : s;
}

// ---------------------------------------------------------------- calendar

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Local wall-clock parts of `now` in a timezone. */
function localParts(now: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    secondsIntoDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

/** First and last calendar day of the month or quarter that contains `day` (YYYY-MM-DD). */
export function periodBounds(period: GoalPeriod, day: string): { start: string; end: string; days: number } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const startMonth = period === "quarter" ? Math.floor((m - 1) / 3) * 3 + 1 : m;
  const months = period === "quarter" ? 3 : 1;
  const start = Date.UTC(y, startMonth - 1, 1);
  const next = Date.UTC(y, startMonth - 1 + months, 1);
  return { start: isoDay(start), end: isoDay(next - DAY_MS), days: Math.round((next - start) / DAY_MS) };
}

export type PeriodClock = { period: GoalPeriod; start: string; end: string; today: string; daysTotal: number; daysElapsed: number };

/** Where `now` falls in the current period, in the workspace timezone. daysElapsed is fractional (today counts partly). */
export function periodClock(period: GoalPeriod, now: Date, tz: string): PeriodClock {
  const local = localParts(now, tz);
  const b = periodBounds(period, local.date);
  const whole = Math.round((dayMs(local.date) - dayMs(b.start)) / DAY_MS);
  const daysElapsed = Math.min(b.days, whole + local.secondsIntoDay / 86_400);
  return { period, start: b.start, end: b.end, today: local.date, daysTotal: b.days, daysElapsed };
}

// ---------------------------------------------------------------- pace

export type PaceStatus = "on_pace" | "at_risk" | "behind" | "early" | "no_data";
export type BudgetStatus = "on_track" | "under" | "over" | "early";

/** Under this many days into a period, projections are too noisy to judge. */
export const EARLY_DAYS = 3;
/** Within 10% of the target (or pace) is amber rather than red. */
export const AMBER_BAND = 0.1;

export type GoalPacing = {
  id: string;
  metric: GoalMetric;
  label: string;
  kind: GoalKind;
  better: "up" | "down";
  cumulative: boolean;
  period: GoalPeriod;
  start: string;
  end: string;
  daysElapsed: number;
  daysTotal: number;
  /** Minor units for money, a count or a ratio otherwise. */
  target: number;
  /** Period to date. null when a ratio has nothing to divide by yet. */
  actual: number | null;
  /** Where a straight line to the target would be today (cumulative metrics only). */
  expectedToDate: number | null;
  /** Run-rate projection to the end of the period (cumulative); the current value for ratios. */
  projected: number | null;
  /** actual ÷ target. */
  progress: number | null;
  /** projected ÷ target. */
  projectedProgress: number | null;
  achieved: boolean;
  status: PaceStatus;
  budget: null | { budgetMinor: number; spentMinor: number; projectedMinor: number | null; progress: number; status: BudgetStatus };
};

const round = (v: number, kind: GoalKind) => (kind === "money" ? Math.round(v) : kind === "count" ? Math.round(v * 100) / 100 : Math.round(v * 10_000) / 10_000);

/** Traffic-light verdict for a point-in-time value against a target, honouring the metric's direction. */
export function stoplight(metric: GoalMetric, value: number | null | undefined, target: number | null | undefined): "good" | "warn" | "bad" | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !target || target <= 0) return null;
  const r = value / target;
  if (GOAL_METRICS[metric].better === "up") return r >= 1 ? "good" : r >= 1 - AMBER_BAND ? "warn" : "bad";
  return r <= 1 ? "good" : r <= 1 + AMBER_BAND ? "warn" : "bad";
}

/** Pure pace calculation for one goal (exported for tests and the widget preview). */
export function computePace(args: {
  id: string;
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;
  actual: number | null;
  budgetMinor: number | null;
  spentMinor: number;
  clock: Pick<PeriodClock, "start" | "end" | "daysElapsed" | "daysTotal">;
}): GoalPacing {
  const def = GOAL_METRICS[args.metric];
  const { clock, target, actual } = args;
  const frac = clock.daysTotal > 0 ? clock.daysElapsed / clock.daysTotal : 0;
  const early = clock.daysElapsed < EARLY_DAYS;

  let expectedToDate: number | null = null;
  let projected: number | null = null;
  if (def.cumulative) {
    expectedToDate = round(target * frac, def.kind);
    projected = actual !== null && clock.daysElapsed > 0 ? round((actual / clock.daysElapsed) * clock.daysTotal, def.kind) : null;
  } else {
    projected = actual;
  }
  const progress = actual !== null ? actual / target : null;
  const projectedProgress = projected !== null ? projected / target : null;

  let achieved = false;
  let status: PaceStatus;
  if (actual === null) status = "no_data";
  else if (def.cumulative) {
    achieved = actual >= target;
    if (achieved) status = "on_pace";
    else if (early) status = "early";
    else {
      const p = projectedProgress ?? 0;
      status = p >= 1 ? "on_pace" : p >= 1 - AMBER_BAND ? "at_risk" : "behind";
    }
  } else {
    const light = stoplight(args.metric, actual, target);
    achieved = light === "good";
    status = early && !achieved ? "early" : light === "good" ? "on_pace" : light === "warn" ? "at_risk" : "behind";
  }

  let budget: GoalPacing["budget"] = null;
  if (args.budgetMinor && args.budgetMinor > 0) {
    const projectedMinor = clock.daysElapsed > 0 ? Math.round((args.spentMinor / clock.daysElapsed) * clock.daysTotal) : null;
    const ratio = projectedMinor === null ? 0 : projectedMinor / args.budgetMinor;
    const budgetStatus: BudgetStatus =
      args.spentMinor > args.budgetMinor ? "over" : early ? "early" : ratio > 1 + AMBER_BAND / 2 ? "over" : ratio < 1 - 2 * AMBER_BAND ? "under" : "on_track";
    budget = { budgetMinor: args.budgetMinor, spentMinor: args.spentMinor, projectedMinor, progress: args.spentMinor / args.budgetMinor, status: budgetStatus };
  }

  return {
    id: args.id,
    metric: args.metric,
    label: def.label,
    kind: def.kind,
    better: def.better,
    cumulative: def.cumulative,
    period: args.period,
    start: clock.start,
    end: clock.end,
    daysElapsed: Math.round(clock.daysElapsed * 10) / 10,
    daysTotal: clock.daysTotal,
    target,
    actual,
    expectedToDate,
    projected,
    progress,
    projectedProgress,
    achieved,
    status,
    budget,
  };
}

export type Targets = Partial<Record<GoalMetric, number>>;

/** The target for one metric, for stoplights: `stoplight("roas", row.roas, targetFor(targets, "roas"))`. */
export function targetFor(targets: Targets, metric: GoalMetric): number | null {
  return targets[metric] ?? null;
}

export type GoalsPacing = {
  currency: string;
  model: AttributionModel;
  today: string;
  items: GoalPacing[];
  /** Goals that could not be paced, with the reason (for example a currency change). */
  skipped: { id: string; metric: GoalMetric; reason: string }[];
};
