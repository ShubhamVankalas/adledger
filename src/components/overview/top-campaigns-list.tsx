"use client";

import Link from "next/link";
import { useState } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import { moneyShort } from "@/lib/format";
import { ratioX } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { NEGATIVE_BG, NEGATIVE_TEXT, POSITIVE_BG } from "./tone";
import { LIST_ROW, WidgetCard, WidgetEmpty } from "./widget-card";

export type CampaignRow = { id: string; name: string; platform: string; spendMinor: number; revenueMinor: number; roas: number | null; href: string };
export type CampaignSort = "revenue" | "roas" | "worst";

const SORTS: [CampaignSort, string][] = [
  ["revenue", "Revenue"],
  ["roas", "ROAS"],
  ["worst", "Worst"],
];

/** Ranking of SQL rows for the toggle (no arithmetic beyond ordering). */
export function rankCampaigns(rows: CampaignRow[], sort: CampaignSort): CampaignRow[] {
  const spent = rows.filter((r) => r.spendMinor > 0);
  if (sort === "roas") return spent.toSorted((a, b) => (b.roas ?? 0) - (a.roas ?? 0) || b.revenueMinor - a.revenueMinor);
  if (sort === "worst") return spent.toSorted((a, b) => (a.roas ?? 0) - (b.roas ?? 0) || b.spendMinor - a.spendMinor);
  return rows.filter((r) => r.revenueMinor !== 0 || r.spendMinor > 0).toSorted((a, b) => b.revenueMinor - a.revenueMinor || b.spendMinor - a.spendMinor);
}

export function SortToggle({ value, onChange }: { value: CampaignSort; onChange: (s: CampaignSort) => void }) {
  return (
    <div role="radiogroup" aria-label="Rank campaigns by" className="flex h-7 items-center rounded-md bg-muted p-0.5 pointer-coarse:h-9">
      {SORTS.map(([k, label], i) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={value === k ? 0 : -1}
          onClick={() => onChange(k)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const j = (i + step + SORTS.length) % SORTS.length;
            onChange(SORTS[j][0]);
            (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            "h-full rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === k && "bg-card text-foreground shadow-xs ring-1 ring-foreground/[0.06]",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const DESCRIPTIONS: Record<CampaignSort, string> = {
  revenue: "Credited revenue and return on ad spend",
  roas: "Best return on ad spend first",
  worst: "Lowest return first, with what they spent",
};

export function TopCampaignsCard({ rows, currency, initialSort = "revenue", topN = 6, allHref, modelLabel }: { rows: CampaignRow[]; currency: string; initialSort?: CampaignSort; topN?: number; allHref: string; modelLabel: string }) {
  const [sort, setSort] = useState<CampaignSort>(initialSort);
  const shown = rankCampaigns(rows, sort).slice(0, topN);
  // Bars share one scale, capped so a single outlier doesn't flatten the rest.
  const cap = Math.min(10, Math.max(2, ...shown.map((r) => r.roas ?? 0)));
  return (
    <WidgetCard
      title={
        <Link href={allHref} className="rounded-sm hover:underline hover:decoration-border hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          Top campaigns
        </Link>
      }
      description={`${DESCRIPTIONS[sort]} · ${modelLabel}`}
      action={<SortToggle value={sort} onChange={setSort} />}
      bodyClassName="pt-1.5"
    >
      {shown.length === 0 ? (
        <WidgetEmpty title="No campaigns in this period">Connect Meta, Google Ads or another ad platform to rank campaigns here.</WidgetEmpty>
      ) : (
      <ol className="flex flex-col">
        {shown.map((r) => {
          const roas = r.roas ?? 0;
          const losing = r.roas !== null && roas < 1;
          return (
            <li key={r.id} className="border-b border-border/70 last:border-0">
              <Link href={r.href} className={LIST_ROW}>
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformBadge platform={r.platform} compact />
                  <span className="truncate text-[13px] font-medium" title={r.name}>
                    {r.name}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold tabular-nums">{sort === "worst" ? moneyShort(r.spendMinor, currency) : moneyShort(r.revenueMinor, currency)}</span>
                  <span aria-hidden className="hidden h-1 w-14 overflow-hidden rounded-full bg-muted sm:block">
                    <span className={cn("block h-full rounded-full", losing ? NEGATIVE_BG : POSITIVE_BG, "opacity-80")} style={{ width: `${Math.max(3, Math.min(100, (roas / cap) * 100))}%` }} />
                  </span>
                  <span className={cn("w-12 text-right text-xs font-medium tabular-nums", losing ? NEGATIVE_TEXT : "text-muted-foreground")}>{ratioX(r.roas)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      )}
    </WidgetCard>
  );
}
