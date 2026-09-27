import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { credit, money, moneyWhole, pct, roas } from "@/lib/format";
import type { ProfitLevel, ProfitRow } from "@/lib/reports-profit";
import { cn } from "@/lib/utils";

/** POAS with its meaning: at 1.0 the ads paid for themselves after every cost. */
export function Poas({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return <span className={cn("num font-medium", value >= 1 ? "text-positive" : value < 0.5 ? "text-negative" : "text-foreground", className)}>{roas(value)}</span>;
}

/** A refund rate this far above the workspace's (and at least 10%) flags the source's buyers. */
const REFUND_FLAG_MULTIPLE = 2;

/**
 * Profit and customer quality per platform, campaign or ad. Numbers straight from profitRows();
 * a row whose buyers refund far more than average gets a "High refunds" tag.
 */
export function ProfitTable({ rows, level, currency: c, workspaceRefundRate }: { rows: ProfitRow[]; level: ProfitLevel; currency: string; workspaceRefundRate: number | null }) {
  const flagAt = Math.max(0.1, (workspaceRefundRate ?? 0) * REFUND_FLAG_MULTIPLE);
  const totals = rows.reduce(
    (t, r) => ({ spend: t.spend + r.spendMinor, revenue: t.revenue + r.revenueMinor, contribution: t.contribution + r.contributionMinor, customers: t.customers + r.customers }),
    { spend: 0, revenue: 0, contribution: 0, customers: 0 },
  );
  const noun = level === "platform" ? "Platform" : level === "campaign" ? "Campaign" : "Ad";
  return (
    <div role="region" aria-label={`Profit by ${noun.toLowerCase()}`} tabIndex={0} className="overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <table className="w-full min-w-[58rem] text-ui [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <thead>
          <tr className="border-y text-caption text-muted-foreground">
            <th scope="col" className="sticky left-0 z-[1] bg-card py-2 pr-3 pl-4 text-left font-medium">
              {noun}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Spend</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Revenue</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Revenue after cost of goods, payment fees and shipping">
              Contribution
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Profit after ads</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">ROAS</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Contribution ÷ spend. 1.00x = the ads paid for themselves after every cost">
              POAS
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Customers</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Share of these customers who paid more than once">
              Repeat
            </th>
            <th scope="col" className="py-2 pr-4 pl-3 text-right font-medium" title="Refunds ÷ payments credited to this row">
              Refunds
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const profit = r.profitAfterAdsMinor;
            const flagged = r.refundRate !== null && r.refundRate >= flagAt && r.grossMinor > 0;
            return (
              <tr key={r.id} className="group/row hover:bg-fill">
                <th scope="row" className="sticky left-0 z-[1] max-w-[11rem] bg-card sm:max-w-[20rem] py-2 pr-3 pl-4 text-left font-normal group-hover/row:bg-fill">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={r.platform} compact={level !== "platform"} className={cn("text-foreground", level === "platform" && "font-medium")} />
                    {level !== "platform" ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium" title={r.name}>
                          {r.name}
                        </span>
                        {r.parentName ? <span className="truncate text-caption text-muted-foreground">{r.parentName}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </th>
                <td className="num px-3 py-2 text-right">{moneyWhole(r.spendMinor, c)}</td>
                <td className="num px-3 py-2 text-right">{moneyWhole(r.revenueMinor, c)}</td>
                <td className="num px-3 py-2 text-right">{moneyWhole(r.contributionMinor, c)}</td>
                <td className={cn("num px-3 py-2 text-right font-medium", profit < 0 ? "text-negative" : profit > 0 ? "text-positive" : "text-muted-foreground")} title={money(profit, c)}>
                  {moneyWhole(profit, c)}
                </td>
                <td className="num px-3 py-2 text-right text-muted-foreground">{roas(r.roas)}</td>
                <td className="px-3 py-2 text-right">
                  <Poas value={r.poas} />
                </td>
                <td className="num px-3 py-2 text-right">{credit(r.customers)}</td>
                <td className="num px-3 py-2 text-right text-muted-foreground">{pct(r.repeatRate, 0)}</td>
                <td className="py-2 pr-4 pl-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {flagged ? <Badge variant="destructive">High</Badge> : null}
                    <span className={cn("num", flagged ? "text-negative" : "text-muted-foreground")}>{pct(r.refundRate)}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-foreground/15 font-medium">
            <th scope="row" className="sticky left-0 z-[1] bg-card py-2 pr-3 pl-4 text-left">
              Credited total
            </th>
            <td className="num px-3 py-2 text-right">{moneyWhole(totals.spend, c)}</td>
            <td className="num px-3 py-2 text-right">{moneyWhole(totals.revenue, c)}</td>
            <td className="num px-3 py-2 text-right">{moneyWhole(totals.contribution, c)}</td>
            <td className={cn("num px-3 py-2 text-right", totals.contribution - totals.spend < 0 ? "text-negative" : "text-positive")}>
              {moneyWhole(totals.contribution - totals.spend, c)}
            </td>
            <td className="num px-3 py-2 text-right text-muted-foreground">{roas(totals.spend > 0 ? totals.revenue / totals.spend : null)}</td>
            <td className="px-3 py-2 text-right">
              <Poas value={totals.spend > 0 ? totals.contribution / totals.spend : null} />
            </td>
            <td className="num px-3 py-2 text-right">{credit(totals.customers)}</td>
            <td className="px-3 py-2" />
            <td className="py-2 pr-4 pl-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
