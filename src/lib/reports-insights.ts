import type { DB } from "./db";
import { moneyShort, pct, platformLabel, signedPct } from "./format";
import { ratioX } from "./metrics";
import { resolvePeriodParams } from "./period";
import { overview, performance, pickWastedSpend, previousPeriod, type PerfRow, type ReportParams } from "./reports";
import type { Workspace } from "./settings";

// Insights → action cards: three to five read-only recommendations, each built only from
// lib/reports rows (SQL). Every figure in a card is a "chip" that links to the report row it came
// from, so nothing has to be taken on trust. The rules are deliberately simple and explainable.

/** A linked figure, or (kind "name") a linked campaign name. */
export type Chip = { text: string; href: string; tone?: "good" | "bad"; kind?: "name" };
export type Segment = string | Chip;
export type ActionCard = {
  id: string;
  kind: "shift" | "cut" | "scale" | "drop" | "cac" | "tracking";
  tone: "warning" | "opportunity" | "info";
  /** The recommendation, as text and number chips. */
  title: Segment[];
  /** One line of evidence. */
  evidence: Segment[];
  action: { label: string; href: string };
  /** Campaign ids the card talks about (for "too early to judge" badges, see ARCHITECTURE.md). */
  campaignIds: string[];
};

const DAY_MS = 86_400_000;
/** Rows below this share of total spend are too small to recommend anything about. */
const MIN_SPEND_SHARE = 0.05;

function query(p: ReportParams, extra: Record<string, string> = {}) {
  return new URLSearchParams({ from: p.start, to: p.end, model: p.model, ...(p.platform ? { platform: p.platform } : {}), ...extra }).toString();
}
const campaignHref = (p: ReportParams, id: string) => `/performance?${query(p, { level: "ad_group", parent: id })}`;
const perfHref = (p: ReportParams) => `/performance?${query(p)}`;
const overviewHref = (p: ReportParams) => `/?${query(p)}`;

const days = (p: ReportParams) => Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / DAY_MS) + 1;

/** Weekly run-rate of a period's spend, rounded to a friendly figure (display only). */
export function weeklyAmount(spendMinor: number, periodDays: number) {
  const weekly = (spendMinor / Math.max(1, periodDays)) * 7;
  const step = weekly >= 1_000_000 ? 100_000 : weekly >= 100_000 ? 10_000 : weekly >= 10_000 ? 1_000 : 100;
  return Math.max(step, Math.round(weekly / step) * step);
}

/**
 * The action cards for a period (default: the last 30 days ending on the latest day with data).
 * Pure reads; the same inputs always give the same cards.
 */
export async function actionCards(db: DB, ws: Workspace, period?: ReportParams): Promise<{ period: ReportParams; cards: ActionCard[] }> {
  const p: ReportParams = period ?? (await resolvePeriodParams(db, ws, { range: "30d", model: "linear" }).then(({ start, end, model }) => ({ start, end, model })));
  const prev = previousPeriod(p);
  const [cur, before, rows, prevRows] = await Promise.all([
    overview(db, ws, p),
    overview(db, ws, prev),
    performance(db, ws, { ...p, level: "campaign" }),
    performance(db, ws, { ...prev, level: "campaign" }),
  ]);
  const cards: ActionCard[] = [];
  const cur$ = ws.reportingCurrency;
  const m = (v: number) => moneyShort(v, cur$);
  const totalSpend = rows.reduce((s, r) => s + r.spendMinor, 0);
  const meaningful = (r: PerfRow) => totalSpend > 0 && r.spendMinor >= totalSpend * MIN_SPEND_SHARE;
  const campaignChip = (r: PerfRow): Chip => ({ text: r.name, href: campaignHref(p, r.id), kind: "name" });
  const roasChip = (r: PerfRow, tone?: Chip["tone"]): Chip => ({ text: ratioX(r.roas), href: campaignHref(p, r.id), tone });

  const waste = pickWastedSpend(rows).filter(meaningful);
  const winners = rows
    .filter((r) => meaningful(r) && r.roas !== null && r.roas >= 1.5 && r.customers > 0)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));

  // 1. Move budget from the biggest money-loser to the best performer.
  const worst = waste[0];
  const best = winners.find((w) => w.id !== worst?.id);
  if (worst && best) {
    const weekly = weeklyAmount(worst.spendMinor, days(p));
    cards.push({
      id: `shift:${worst.id}:${best.id}`,
      kind: "shift",
      tone: "opportunity",
      title: ["Shift about ", { text: `${m(weekly)}/week`, href: campaignHref(p, worst.id) }, " from ", campaignChip(worst), " (", roasChip(worst, "bad"), ") to ", campaignChip(best), " (", roasChip(best, "good"), ")"],
      evidence: [
        campaignChip(worst),
        " spent ",
        { text: m(worst.spendMinor), href: campaignHref(p, worst.id) },
        " and brought ",
        { text: m(worst.revenueMinor), href: campaignHref(p, worst.id) },
        `. ${platformLabel(best.platform)} campaign `,
        campaignChip(best),
        " turned ",
        { text: m(best.spendMinor), href: campaignHref(p, best.id) },
        " into ",
        { text: m(best.revenueMinor), href: campaignHref(p, best.id) },
        ".",
      ],
      action: { label: "Compare in Performance", href: perfHref(p) },
      campaignIds: [worst.id, best.id],
    });
  } else if (worst) {
    cards.push({
      id: `cut:${worst.id}`,
      kind: "cut",
      tone: "warning",
      title: ["Review ", campaignChip(worst), ": ", { text: m(worst.spendMinor), href: campaignHref(p, worst.id) }, " spent at ", roasChip(worst, "bad"), " ROAS"],
      evidence: ["It brought ", { text: m(worst.revenueMinor), href: campaignHref(p, worst.id) }, " in the period. Check the ad sets before pausing anything: some sales may still be on their way."],
      action: { label: "Open its ad sets", href: campaignHref(p, worst.id) },
      campaignIds: [worst.id],
    });
  }

  // 2. A strong campaign with a small share of spend may have room to grow.
  const overall = cur.roas;
  const used = new Set(cards.flatMap((c) => c.campaignIds));
  const scale = winners.find((w) => !used.has(w.id) && overall !== null && (w.roas ?? 0) >= overall * 1.5 && w.spendMinor < totalSpend * 0.2);
  if (scale) {
    cards.push({
      id: `scale:${scale.id}`,
      kind: "scale",
      tone: "opportunity",
      title: [campaignChip(scale), " returns ", roasChip(scale, "good"), " on ", { text: pct(scale.spendMinor / totalSpend, 0), href: perfHref(p) }, " of your spend"],
      evidence: ["That is well above your overall ", { text: ratioX(overall), href: overviewHref(p) }, ". Raise its budget in steps and watch CAC."],
      action: { label: "Open its ad sets", href: campaignHref(p, scale.id) },
      campaignIds: [scale.id],
    });
  }

  // 3. The biggest revenue drop against the previous period.
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  const drop = rows
    .map((r) => ({ r, before: prevById.get(r.id) }))
    .filter(({ r, before }) => before && before.revenueMinor > 0 && r.revenueMinor < before.revenueMinor * 0.7 && before.revenueMinor - r.revenueMinor >= Math.max(1, cur.revenueMinor * 0.03))
    .sort((a, b) => b.before!.revenueMinor - b.r.revenueMinor - (a.before!.revenueMinor - a.r.revenueMinor))[0];
  if (drop && cards.length < 5) {
    const change = (drop.r.revenueMinor - drop.before!.revenueMinor) / drop.before!.revenueMinor;
    cards.push({
      id: `drop:${drop.r.id}`,
      kind: "drop",
      tone: "warning",
      title: ["Revenue from ", campaignChip(drop.r), " fell ", { text: signedPct(change, 0), href: campaignHref(p, drop.r.id), tone: "bad" }],
      evidence: [
        { text: m(drop.before!.revenueMinor), href: campaignHref(prev, drop.r.id) },
        " in the previous period, ",
        { text: m(drop.r.revenueMinor), href: campaignHref(p, drop.r.id) },
        " now, on ",
        { text: m(drop.r.spendMinor), href: campaignHref(p, drop.r.id) },
        " spend. Check for a paused ad, a changed landing page or creative fatigue.",
      ],
      action: { label: "Open its ad sets", href: campaignHref(p, drop.r.id) },
      campaignIds: [drop.r.id],
    });
  }

  // 4. Customers got more expensive.
  if (cur.cacMinor !== null && before.cacMinor !== null && before.cacMinor > 0 && cur.cacMinor >= before.cacMinor * 1.2 && cards.length < 5) {
    cards.push({
      id: "cac",
      kind: "cac",
      tone: "warning",
      title: ["Customer cost rose ", { text: signedPct((cur.cacMinor - before.cacMinor) / before.cacMinor, 0), href: overviewHref(p), tone: "bad" }, " to ", { text: m(cur.cacMinor), href: overviewHref(p) }],
      evidence: ["It was ", { text: m(before.cacMinor), href: overviewHref(prev) }, " in the previous period. Ad spend moved ", { text: signedPct(before.spendMinor ? (cur.spendMinor - before.spendMinor) / before.spendMinor : null, 0), href: overviewHref(p) }, "."],
      action: { label: "See the trend", href: overviewHref(p) },
      campaignIds: [],
    });
  }

  // 5. A lot of revenue isn't linked to any ad: attribution can't be trusted until tracking is fixed.
  if (cur.unattributedShare !== null && cur.unattributedShare >= 0.4 && cur.revenueMinor > 0 && cards.length < 5) {
    cards.push({
      id: "tracking",
      kind: "tracking",
      tone: "info",
      title: [{ text: pct(cur.unattributedShare, 0), href: overviewHref(p) }, " of revenue isn’t linked to any ad"],
      evidence: ["That is ", { text: m(cur.unattributedRevenueMinor), href: overviewHref(p) }, ". Make sure the pixel is on every page and your ads carry UTM tags, so these sales can be credited."],
      action: { label: "Check tracking", href: "/settings/workspace/tracking" },
      campaignIds: [],
    });
  }

  return { period: p, cards: cards.slice(0, 5) };
}

/** Plain text of a card (for tests and screen-reader summaries). */
export const segmentsText = (s: Segment[]) => s.map((x) => (typeof x === "string" ? x : x.text)).join("");
