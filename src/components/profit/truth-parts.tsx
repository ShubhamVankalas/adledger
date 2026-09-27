import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { credit, money, moneyShort, moneyWhole, num, platformLabel, roas } from "@/lib/format";
import type { TruthGap, TruthRow } from "@/lib/reports-trust";
import { cn } from "@/lib/utils";

/** "1.9× claimed" / "matches" / "under-claims": how far a platform's claim is from verified money. */
export function ClaimRatio({ ratio, className }: { ratio: number | null; className?: string }) {
  if (ratio === null || !Number.isFinite(ratio)) return <span className={cn("text-caption text-muted-foreground", className)}>—</span>;
  if (ratio <= 1.1 && ratio >= 0.9) return <Badge variant="positive" className={className}>Matches</Badge>;
  if (ratio < 0.9) return <Badge variant="secondary" className={className}>Under-reports</Badge>;
  return (
    <Badge variant={ratio >= 1.25 ? "warning" : "secondary"} className={cn("num", className)}>
      {ratio >= 10 ? ">10" : ratio.toFixed(1)}× claimed
    </Badge>
  );
}

/**
 * The headline: the platform with the biggest value gap, in one sentence. Falls back to
 * conversion counts when no platform reports purchase value.
 */
export function TruthHeadline({ gap, top }: { gap: TruthGap; top: TruthRow | null }) {
  const c = gap.currency;
  const t = gap.totals;
  if (top && top.platformValueMinor !== null) {
    return (
      <div className="space-y-2">
        <p className="max-w-3xl text-title text-balance">
          {platformLabel(top.platform)} says its ads made you <span className="num">{moneyWhole(top.platformValueMinor, c)}</span>.{" "}
          <span className="block text-muted-foreground">
            Real payments from people who clicked them: <span className="num text-foreground">{moneyWhole(top.verifiedRevenueMinor, c)}</span>.
          </span>
        </p>
        <p className="max-w-3xl text-body text-pretty text-muted-foreground">
          That&rsquo;s <span className="num font-medium text-foreground">{moneyShort(top.valueGapMinor ?? 0, c)}</span> of sales that never reached your
          account.
          {t.claimToRevenue !== null && t.claimToRevenue > 1 ? (
            <>
              {" "}
              Together, your ad platforms claim <span className="num font-medium text-foreground">{moneyShort(t.platformValueMinor, c)}</span>, more than the{" "}
              <span className="num font-medium text-foreground">{moneyShort(t.revenueMinor, c)}</span> your whole business took in.
            </>
          ) : null}
        </p>
      </div>
    );
  }
  const byConv = [...gap.platforms].filter((r) => r.conversionRatio !== null).sort((a, b) => (b.conversionRatio ?? 0) - (a.conversionRatio ?? 0))[0];
  if (byConv) {
    return (
      <p className="max-w-3xl text-title text-balance">
        {platformLabel(byConv.platform)} reports <span className="num">{credit(byConv.platformConversions)}</span> conversions.{" "}
        <span className="text-muted-foreground">
          AdLedger can verify <span className="num text-foreground">{num(byConv.verifiedConversions)}</span> leads and sales from people who clicked.
        </span>
      </p>
    );
  }
  return <p className="max-w-3xl text-title text-balance">No platform reported conversions for this period, so there is nothing to compare yet.</p>;
}

/** Claimed vs verified value for one platform as two bars on a shared scale. */
export function ClaimBars({ row, max, currency }: { row: TruthRow; max: number; currency: string }) {
  const w = (v: number) => `${max > 0 ? Math.max(0.5, (Math.max(0, v) / max) * 100) : 0}%`;
  const claimed = row.platformValueMinor;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_6rem] items-center gap-3 text-caption sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem]">
        <span className="text-muted-foreground">Claimed</span>
        <div className="h-2.5 overflow-hidden rounded-[3px] bg-fill">
          {claimed !== null ? (
            <div
              className="h-full rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--fg-faint)_0_3px,transparent_3px_6px)] ring-1 ring-fg-faint/60 ring-inset"
              style={{ width: w(claimed) }}
            />
          ) : null}
        </div>
        <span className="num text-right">{claimed === null ? "not reported" : moneyWhole(claimed, currency)}</span>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_6rem] items-center gap-3 text-caption sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem]">
        <span className="text-muted-foreground">Verified</span>
        <div className="h-2.5 overflow-hidden rounded-[3px] bg-fill">
          <div className="h-full rounded-[3px] bg-brand" style={{ width: w(row.verifiedRevenueMinor) }} />
        </div>
        <span className="num text-right font-medium">{moneyWhole(row.verifiedRevenueMinor, currency)}</span>
      </div>
    </div>
  );
}

/** One platform: name, the two bars, the ratio and the count comparison. */
export function PlatformTruth({ row, max, currency }: { row: TruthRow; max: number; currency: string }) {
  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[10rem_minmax(0,1fr)_12.5rem] md:items-center md:gap-6">
      <div className="flex items-center justify-between gap-2 md:block md:space-y-1">
        <PlatformBadge platform={row.platform} className="text-ui font-medium text-foreground" />
        <p className="num text-caption text-muted-foreground">{moneyWhole(row.spendMinor, currency)} spend</p>
      </div>
      <ClaimBars row={row} max={max} currency={currency} />
      <div className="flex items-center justify-between gap-2 md:flex-col md:items-end md:gap-1">
        <ClaimRatio ratio={row.valueRatio ?? row.conversionRatio} />
        <p className="num text-caption text-muted-foreground" title="Conversions the platform reported vs leads and first sales AdLedger verified">
          {credit(row.platformConversions)} reported · {num(row.verifiedConversions)} verified
        </p>
      </div>
    </li>
  );
}

/** Per-campaign table: reported vs verified vs credited, with the gap. */
export function TruthCampaignTable({ rows, currency: c, modelLabel }: { rows: TruthRow[]; currency: string; modelLabel: string }) {
  return (
    <div role="region" aria-label="Truth gap by campaign" tabIndex={0} className="overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <table className="w-full min-w-[56rem] text-ui [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-y text-caption font-medium text-muted-foreground">
            <th scope="col" className="sticky left-0 bg-card py-2 pr-3 pl-4 text-left font-medium">
              Campaign
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Spend</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Reported conv.</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Verified</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Claimed value</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Verified revenue</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{modelLabel} credit</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Platform ROAS</th>
            <th scope="col" className="py-2 pr-4 pl-3 text-right font-medium">Gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="group/row hover:bg-fill">
              <th scope="row" className="sticky left-0 max-w-[11rem] bg-card sm:max-w-[18rem] py-2 pr-3 pl-4 text-left font-normal group-hover/row:bg-fill">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformBadge platform={r.platform} compact className="text-foreground" />
                  <span className="truncate font-medium" title={r.name}>
                    {r.name}
                  </span>
                </span>
              </th>
              <td className="num px-3 py-2 text-right">{moneyWhole(r.spendMinor, c)}</td>
              <td className="num px-3 py-2 text-right">{credit(r.platformConversions)}</td>
              <td className="num px-3 py-2 text-right">{num(r.verifiedConversions)}</td>
              <td className="num px-3 py-2 text-right">{r.platformValueMinor === null ? <span className="text-muted-foreground">—</span> : moneyWhole(r.platformValueMinor, c)}</td>
              <td className="num px-3 py-2 text-right font-medium">{moneyWhole(r.verifiedRevenueMinor, c)}</td>
              <td className="num px-3 py-2 text-right">{moneyWhole(r.creditedRevenueMinor, c)}</td>
              <td className="num px-3 py-2 text-right" title={`Credited ROAS ${roas(r.creditedRoas)}`}>
                {roas(r.platformRoas)} <span className="text-caption text-muted-foreground">vs {roas(r.creditedRoas)}</span>
              </td>
              <td className="num py-2 pr-4 pl-3 text-right">
                {r.valueGapMinor === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={r.valueGapMinor > 0 ? "text-warning-foreground" : "text-muted-foreground"} title={money(r.valueGapMinor, c)}>
                    {r.valueGapMinor > 0 ? "+" : ""}
                    {moneyShort(r.valueGapMinor, c)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
