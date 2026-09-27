import { CalendarRangeIcon, UsersIcon } from "lucide-react";
import { PlatformBadge } from "@/components/platform-badge";
import {
  ReportEmpty,
  ROW_HOVER,
  STICKY_HEAD_BG,
  STICKY_ROW_BG,
} from "@/components/reports/report-ui";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { channelLabel, countLabel, credit, creditTitle, moneyShort, moneyWhole, num, plural } from "@/lib/format";
import type { LtvChannelRow, LtvCohort } from "@/lib/reports-advanced";
import { cn } from "@/lib/utils";

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const ratioLabel = (v: number | null) =>
  v === null ? "—" : `${v.toFixed(1)}:1`;

function ratioClass(v: number | null) {
  if (v === null) return "text-muted-foreground";
  if (v >= 3) return "bg-success/12 text-success";
  if (v >= 1) return "bg-warning/20 text-foreground";
  return "bg-destructive/10 text-destructive";
}

function Ratio({ v, className }: { v: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "tabular inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold",
        ratioClass(v),
        className,
      )}
    >
      {ratioLabel(v)}
    </span>
  );
}

/** Keyboard-scrollable wrapper for tables that may scroll sideways on phones. */
function ScrollRegion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto overscroll-x-contain border-y outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}

function Source({ row }: { row: LtvChannelRow }) {
  if (row.platform) return <PlatformBadge platform={row.platform} className="font-medium text-foreground" />;
  return (
    <span className="font-medium">{channelLabel(row.key)}</span>
  );
}

/** Cohort heatmap: cumulative revenue per customer by month since first payment. */
export function CohortTable({
  cohorts,
  currency: c,
}: {
  cohorts: LtvCohort[];
  currency: string;
}) {
  if (cohorts.length === 0) {
    return (
      <ReportEmpty
        icon={CalendarRangeIcon}
        title="No first payments in this period"
      >
        Cohorts appear once customers make their first payment. Try a longer
        date range.
      </ReportEmpty>
    );
  }
  const width = Math.max(1, ...cohorts.map((x) => x.revenueMinor.length));
  const maxLtv = Math.max(1, ...cohorts.flatMap((x) => x.cumulativeLtvMinor));
  return (
    <div className="@container">
      <ScrollRegion label="Cohorts">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <TableHeader className="[&_th]:border-b [&_tr]:border-0">
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              <TableHead
                className={cn(
                  "sticky left-0 z-10 border-r pl-4 text-muted-foreground",
                  STICKY_HEAD_BG,
                )}
              >
                Cohort
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground @xl:table-cell">
                Customers
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground @xl:table-cell">
                Revenue
              </TableHead>
              {Array.from({ length: width }, (_, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    "min-w-20 text-right text-muted-foreground",
                    i === width - 1 && "pr-4",
                  )}
                >
                  Month {i}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0 [&_tr]:border-0">
            {cohorts.map((co) => (
              <TableRow key={co.cohort} className={ROW_HOVER}>
                <TableCell
                  className={cn(
                    "sticky left-0 z-10 border-r pl-4",
                    STICKY_ROW_BG,
                  )}
                >
                  <div className="font-medium">{monthLabel(co.cohort)}</div>
                  <div className="tabular text-xs text-muted-foreground @xl:hidden">
                    {plural(co.customers, "customer")} ·{" "}
                    {moneyShort(co.totalRevenueMinor, c)}
                  </div>
                </TableCell>
                <TableCell className="tabular hidden text-right @xl:table-cell">
                  {num(co.customers)}
                </TableCell>
                <TableCell className="tabular hidden text-right @xl:table-cell">
                  {moneyWhole(co.totalRevenueMinor, c)}
                </TableCell>
                {Array.from({ length: width }, (_, i) => {
                  const v = co.cumulativeLtvMinor[i];
                  const last = i === width - 1 && "pr-4";
                  if (v === undefined)
                    return <TableCell key={i} className={cn("p-1", last)} />;
                  const alpha = Math.max(0.08, Math.min(1, v / maxLtv) * 0.55);
                  return (
                    <TableCell key={i} className={cn("p-1", last)}>
                      <div
                        className="tabular rounded-md px-2 py-1.5 text-right text-xs font-medium"
                        style={{
                          backgroundColor: `color-mix(in oklch, var(--chart-revenue) ${Math.round(alpha * 100)}%, transparent)`,
                        }}
                        title={`${moneyWhole(co.revenueMinor[i], c)} revenue in month ${i}`}
                      >
                        {moneyShort(v, c)}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </ScrollRegion>
    </div>
  );
}

/** LTV, CAC and LTV:CAC per acquiring platform or channel. */
export function ChannelTable({
  channels,
  currency: c,
}: {
  channels: LtvChannelRow[];
  currency: string;
}) {
  if (channels.length === 0) {
    return (
      <ReportEmpty
        icon={UsersIcon}
        title="No customers acquired in this period"
      >
        Customers show up here after their first payment is matched to a
        journey.
      </ReportEmpty>
    );
  }
  return (
    <div className="@container">
      {/* One table at every width: on narrow containers the secondary columns fold into the source cell. */}
      <ScrollRegion label="LTV:CAC by channel">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <TableHeader className="[&_th]:border-b [&_tr]:border-0">
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              <TableHead className="pl-4 text-muted-foreground">
                Acquired by
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground @2xl:table-cell">
                Customers
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground @2xl:table-cell">
                Revenue
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                LTV
              </TableHead>
              <TableHead className="hidden text-right text-muted-foreground @2xl:table-cell">
                Spend
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                CAC
              </TableHead>
              <TableHead className="pr-4 text-right text-muted-foreground">
                LTV:CAC
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0 [&_tr]:border-0">
            {channels.map((x) => (
              <TableRow key={x.key} className={ROW_HOVER}>
                <TableCell className="py-2.5 pr-1 pl-4">
                  <Source row={x} />
                  <div className="tabular mt-1 text-xs text-muted-foreground @2xl:hidden">
                    {countLabel(x.customers, "customer")} ·{" "}
                    {moneyShort(x.revenueMinor, c)}
                  </div>
                </TableCell>
                <TableCell
                  className="tabular hidden text-right @2xl:table-cell"
                  title={creditTitle(x.customers, "customers")}
                >
                  {credit(x.customers)}
                </TableCell>
                <TableCell className="tabular hidden text-right @2xl:table-cell">
                  {moneyWhole(x.revenueMinor, c)}
                </TableCell>
                <TableCell className="tabular text-right font-medium">
                  {moneyWhole(x.ltvMinor, c)}
                </TableCell>
                <TableCell className="tabular hidden text-right @2xl:table-cell">
                  {x.spendMinor ? (
                    moneyWhole(x.spendMinor, c)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">
                  {x.cacMinor === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    moneyWhole(x.cacMinor, c)
                  )}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Ratio v={x.ltvCac} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </ScrollRegion>
    </div>
  );
}
