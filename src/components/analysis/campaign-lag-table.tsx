import { PlatformBadge } from "@/components/platform-badge";
import { num } from "@/lib/format";
import type { CampaignLagRow } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { daysLabel, ScrollTable } from "./primitives";

// Per-campaign time to convert: median and 80th percentile from the campaign's first touch in
// the attribution window to the purchase (and to the lead). A thin bar shows the median against
// the slowest campaign so fast and slow campaigns stand apart.

const TH = "h-9 px-3 text-right text-caption font-medium whitespace-nowrap text-muted-foreground first:pl-0 last:pr-0";
const TD = "h-11 px-3 text-right whitespace-nowrap tabular-nums first:pl-0 last:pr-0";

export function CampaignLagTable({ rows, windowDays }: { rows: CampaignLagRow[]; windowDays: number }) {
  const slowest = Math.max(1, ...rows.map((r) => r.p80Days ?? r.medianDays ?? 0));
  return (
    <ScrollTable label="Time to convert by campaign">
      <table className="w-full min-w-[40rem] border-collapse text-ui">
        <thead>
          <tr className="border-b">
            <th scope="col" className={cn(TH, "sticky left-0 z-10 bg-card text-left")}>
              Campaign
            </th>
            <th scope="col" className={TH}>
              Customers
            </th>
            <th scope="col" className={cn(TH, "w-[30%]")}>
              <span className="sr-only">Median time to purchase, relative to the slowest campaign</span>
            </th>
            <th scope="col" className={TH}>
              Median
            </th>
            <th scope="col" className={TH}>
              80% within
            </th>
            <th scope="col" className={cn(TH, "border-l")}>
              Leads
            </th>
            <th scope="col" className={TH}>
              Median
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const med = r.medianDays;
            const p80 = r.p80Days;
            const slow = p80 !== null && p80 > windowDays * 0.8;
            return (
              <tr key={r.id}>
                <td className={cn(TD, "sticky left-0 z-10 max-w-[11rem] bg-card text-left sm:max-w-[16rem]")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={r.platform} compact />
                    <span className="truncate font-medium" title={r.name}>
                      {r.name}
                    </span>
                  </span>
                </td>
                <td className={TD}>{r.customers ? num(r.customers) : <span className="text-fg-faint">0</span>}</td>
                <td className={cn(TD, "pl-4")} aria-hidden>
                  {med !== null ? (
                    <span className="relative block h-1.5 rounded-full bg-fill">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--chart-customers)]/30" style={{ width: `${((p80 ?? med) / slowest) * 100}%` }} />
                      <span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--chart-customers)]" style={{ width: `${Math.max(2, (med / slowest) * 100)}%` }} />
                    </span>
                  ) : null}
                </td>
                <td className={TD}>{daysLabel(med, { short: true })}</td>
                <td className={cn(TD, slow && "text-warning-foreground")} title={slow ? `Some buyers take close to or longer than your ${windowDays}-day window` : undefined}>
                  {daysLabel(p80, { short: true })}
                </td>
                <td className={cn(TD, "border-l")}>{r.leads ? num(r.leads) : <span className="text-fg-faint">0</span>}</td>
                <td className={TD}>{daysLabel(r.leadMedianDays, { short: true })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}
