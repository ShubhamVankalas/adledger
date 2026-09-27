import { SparklesIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { buildBriefing, periodPhrase } from "@/lib/dashboard/briefing";
import { loadCampaigns, loadKpiPair, loadWarnings, type DashParams } from "@/lib/dashboard/data";
import { moneyShort, platformLabel } from "@/lib/format";
import { ratioX, type Delta } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "./tone";
import { SURFACE } from "./styles";

// The one-sentence answer above the board, filled from SQL numbers (never the LLM).

const Num = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-foreground tabular-nums">{children}</span>;

function RoasClause({ delta, roas, vs }: { delta: Delta; roas: number | null; vs: string }) {
  if (roas === null) return null;
  if (delta.tone === "none") return <> ROAS is <Num>{ratioX(roas)}</Num>.</>;
  if (delta.tone === "flat") return <> ROAS held at <Num>{ratioX(roas)}</Num> against {vs}.</>;
  return (
    <>
      {" "}ROAS is{" "}
      <span className={cn("font-medium", TONE_TEXT[delta.tone])}>
        {delta.direction === "up" ? "up" : "down"} {delta.text}
      </span>{" "}
      on {vs}.
    </>
  );
}

export async function Briefing({ p, currency }: { p: DashParams; currency: string }) {
  const [[cur, prev], campaigns] = await Promise.all([loadKpiPair(p), loadCampaigns(p.start, p.end, p.model, p.platform)]);
  const b = buildBriefing({
    campaigns,
    spendMinor: cur.raw.spendMinor,
    revenueMinor: cur.raw.revenueMinor,
    attributedRevenueMinor: cur.raw.attributedRevenueMinor,
    roas: cur.totals.roas,
    prevRoas: prev.totals.roas,
  });
  const { inPeriod, vsPrevious } = periodPhrase(p.range);
  const query = new URLSearchParams({ range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) });

  let sentence: React.ReactNode;
  if (b.kind === "top") {
    query.set("level", "ad_group");
    query.set("parent", b.campaign.id);
    sentence = (
      <>
        <Link
          href={`/performance?${query}`}
          className="font-medium text-foreground underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground/60 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {platformLabel(b.campaign.platform)} · {b.campaign.name}
        </Link>{" "}
        made the most profit {inPeriod}: <Num>{moneyShort(b.revenueMinor, currency)}</Num> back on <Num>{moneyShort(b.spendMinor, currency)}</Num> of spend.
        <RoasClause delta={b.roasDelta} roas={b.roas} vs={vsPrevious} />
      </>
    );
  } else if (b.kind === "noProfit") {
    sentence = (
      <>
        No campaign has paid back its spend {inPeriod} yet: <Num>{moneyShort(b.spendMinor, currency)}</Num> spent, <Num>{moneyShort(b.attributedRevenueMinor, currency)}</Num> credited to ads.
        <RoasClause delta={b.roasDelta} roas={b.roas} vs={vsPrevious} />
      </>
    );
  } else if (b.kind === "noSpend") {
    sentence = (
      <>
        No ad spend {inPeriod}. You earned <Num>{moneyShort(b.revenueMinor, currency)}</Num> in revenue.
      </>
    );
  } else {
    sentence = <>No ad spend or revenue {inPeriod} yet. Try a longer date range.</>;
  }

  return (
    <p className={cn(SURFACE, "flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm leading-[22px] text-pretty text-muted-foreground")}>
      <SparklesIcon aria-hidden className="mt-[3px] size-4 shrink-0 text-[color:var(--chart-revenue,var(--chart-1))]" strokeWidth={1.75} />
      <span>{sentence}</span>
    </p>
  );
}

export function BriefingSkeleton() {
  return (
    <div aria-busy aria-label="Loading the summary" className={cn(SURFACE, "flex h-[46px] items-center gap-2.5 rounded-xl px-4")}>
      <SparklesIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/40" strokeWidth={1.75} />
      <span className="block h-3.5 w-2/3 animate-pulse rounded bg-foreground/[0.055] [animation-duration:1.6s]" />
    </div>
  );
}

/** Currency mismatches that exclude rows from the totals. */
export async function CurrencyWarnings({ p }: { p: DashParams }) {
  const warnings = await loadWarnings(p.start, p.end);
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((w) => (
        <p key={w} role="status" className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 px-3 py-2 text-[13px]">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-[color:var(--warning)]" /> {w}
        </p>
      ))}
    </div>
  );
}
