import { GitCompareArrowsIcon } from "lucide-react";
import { PlatformBadge } from "@/components/platform-badge";
import {
  ReportEmpty,
  ROW_HOVER,
  shortMoney,
  STICKY_HEAD_BG,
  STICKY_ROW_BG,
} from "@/components/reports/report-ui";
import { Badge } from "@/components/ui/badge";
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { roas } from "@/lib/format";
import type {
  JourneyRole,
  ModelComparison,
  ModelResult,
} from "@/lib/reports-advanced";
import { cn } from "@/lib/utils";

export const ROLE: Record<
  JourneyRole,
  { label: string; short: string; className: string; bar: string }
> = {
  starter: {
    label: "Starts journeys",
    short: "Starter",
    className: "bg-chart-2/15 text-foreground",
    bar: "bg-chart-2",
  },
  closer: {
    label: "Closes journeys",
    short: "Closer",
    className: "bg-chart-3/20 text-foreground",
    bar: "bg-chart-3",
  },
  balanced: {
    label: "Balanced",
    short: "Balanced",
    className: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/40",
  },
};

const MODELS = [
  { key: "firstTouch", label: "First touch" },
  { key: "lastTouch", label: "Last touch" },
  { key: "linear", label: "Linear" },
] as const;

function RoleDot({ role }: { role: JourneyRole }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", ROLE[role].bar)}
    />
  );
}

const roasTone = (m: ModelResult) =>
  (m.roas ?? 0) >= 1 ? "text-success" : "text-muted-foreground";
const signed = (minor: number, c: string) =>
  `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${shortMoney(Math.abs(minor), c)}`;

/** Centre-anchored bar: right of centre = earns more under first touch, left = under last touch. */
function DeltaBar({
  delta,
  max,
  role,
  className,
}: {
  delta: number;
  max: number;
  role: JourneyRole;
  className?: string;
}) {
  const width = (Math.abs(delta) / max) * 50;
  return (
    <div
      className={cn(
        "relative h-2 overflow-hidden rounded-full bg-muted",
        className,
      )}
      aria-hidden
    >
      <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/20" />
      <div
        className={cn("absolute inset-y-0 rounded-full", ROLE[role].bar)}
        style={
          delta >= 0
            ? { left: "50%", width: `${width}%` }
            : { right: "50%", width: `${width}%` }
        }
      />
    </div>
  );
}

function ModelCells({ m, currency }: { m: ModelResult; currency: string }) {
  return (
    <>
      <TableCell className="tabular border-l text-right">
        {shortMoney(m.revenueMinor, currency)}
      </TableCell>
      <TableCell
        className={cn("tabular text-right text-xs font-medium", roasTone(m))}
      >
        {roas(m.roas)}
      </TableCell>
    </>
  );
}

export function ModelComparisonTable({
  report: r,
  currency: c,
}: {
  report: ModelComparison;
  currency: string;
}) {
  if (r.rows.length === 0) {
    return (
      <ReportEmpty
        icon={GitCompareArrowsIcon}
        title="No campaign spend or credited revenue in this period"
      >
        Pick a longer date range to compare how each model credits your
        campaigns.
      </ReportEmpty>
    );
  }
  const maxDelta = Math.max(1, ...r.rows.map((x) => Math.abs(x.deltaMinor)));

  return (
    <div className="@container">
      {/* Wide containers: full comparison table, campaign column pinned while scrolling sideways. */}
      <div
        role="region"
        aria-label="Revenue by attribution model"
        tabIndex={0}
        className="hidden overflow-x-auto overscroll-x-contain border-y outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset @3xl:block"
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <TableHeader className="[&_th]:border-b [&_tr]:border-0">
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              <TableHead
                rowSpan={2}
                className={cn(
                  "sticky left-0 z-10 border-r pl-4 text-muted-foreground",
                  STICKY_HEAD_BG,
                )}
              >
                Campaign
              </TableHead>
              <TableHead
                rowSpan={2}
                className="text-right text-muted-foreground"
              >
                Spend
              </TableHead>
              {MODELS.map((m) => (
                <TableHead
                  key={m.key}
                  colSpan={2}
                  className="h-8 border-l text-center"
                >
                  {m.label}
                </TableHead>
              ))}
              <TableHead
                rowSpan={2}
                className="border-l pr-4 text-muted-foreground"
              >
                First − last touch
              </TableHead>
            </TableRow>
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              {MODELS.flatMap((m) => [
                <TableHead
                  key={`${m.key}-rev`}
                  className="h-7 border-l text-right text-xs font-normal text-muted-foreground"
                >
                  Revenue
                </TableHead>,
                <TableHead
                  key={`${m.key}-roas`}
                  className="h-7 text-right text-xs font-normal text-muted-foreground"
                >
                  ROAS
                </TableHead>,
              ])}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0 [&_tr]:border-0">
            {r.rows.map((x) => (
              <TableRow key={x.id} className={ROW_HOVER}>
                <TableCell
                  className={cn(
                    "sticky left-0 z-10 max-w-56 border-r pl-4 @6xl:max-w-80",
                    STICKY_ROW_BG,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={x.platform} compact />
                    <span className="truncate font-medium" title={x.name}>
                      {x.name}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="tabular text-right">
                  {shortMoney(x.spendMinor, c)}
                </TableCell>
                <ModelCells m={x.firstTouch} currency={c} />
                <ModelCells m={x.lastTouch} currency={c} />
                <ModelCells m={x.linear} currency={c} />
                <TableCell className="border-l pr-4">
                  <div className="flex items-center gap-3">
                    <DeltaBar
                      delta={x.deltaMinor}
                      max={maxDelta}
                      role={x.role}
                      className="w-16 shrink-0 @5xl:w-24"
                    />
                    <span className="tabular w-16 shrink-0 text-right text-xs font-medium">
                      {signed(x.deltaMinor, c)}
                    </span>
                    <Badge
                      className={cn(
                        "min-w-22 shrink-0 justify-start",
                        ROLE[x.role].className,
                      )}
                      title={ROLE[x.role].label}
                    >
                      <RoleDot role={x.role} />
                      {ROLE[x.role].short}
                    </Badge>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-0 bg-transparent [&_td]:border-t">
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              <TableCell
                className={cn(
                  "sticky left-0 z-10 border-r pl-4 font-semibold",
                  STICKY_HEAD_BG,
                )}
              >
                All campaigns
              </TableCell>
              <TableCell className="tabular text-right font-semibold">
                {shortMoney(r.totals.spendMinor, c)}
              </TableCell>
              <ModelCells m={r.totals.firstTouch} currency={c} />
              <ModelCells m={r.totals.lastTouch} currency={c} />
              <ModelCells m={r.totals.linear} currency={c} />
              <TableCell className="border-l" />
            </TableRow>
          </TableFooter>
        </table>
      </div>

      {/* Narrow containers: one card per campaign with the three models side by side. */}
      <ul
        className="grid grid-cols-1 gap-3 px-4 @xl:grid-cols-2 @3xl:hidden"
        aria-label="Campaigns"
      >
        {r.rows.map((x) => (
          <li key={x.id} className="rounded-xl border bg-background/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium break-words">
                  {x.name}
                </p>
                <p className="tabular mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PlatformBadge platform={x.platform} />
                  {shortMoney(x.spendMinor, c)} spend
                </p>
              </div>
              <Badge className={cn("shrink-0", ROLE[x.role].className)}>
                <RoleDot role={x.role} />
                {ROLE[x.role].label}
              </Badge>
            </div>
            <dl className="mt-3 grid grid-cols-3 divide-x rounded-lg border bg-card text-center">
              {MODELS.map((m) => (
                <div key={m.key} className="min-w-0 px-1.5 py-2">
                  <dt className="truncate text-[11px] text-muted-foreground">
                    {m.label}
                  </dt>
                  <dd className="tabular mt-0.5 truncate text-sm font-medium">
                    {shortMoney(x[m.key].revenueMinor, c)}
                  </dd>
                  <dd
                    className={cn(
                      "tabular text-xs font-medium",
                      roasTone(x[m.key]),
                    )}
                  >
                    {roas(x[m.key].roas)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Last</span>
              <DeltaBar
                delta={x.deltaMinor}
                max={maxDelta}
                role={x.role}
                className="flex-1"
              />
              <span className="text-[11px] text-muted-foreground">First</span>
              <span className="tabular w-16 text-right text-xs font-semibold">
                {signed(x.deltaMinor, c)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <dl
        className="mx-4 mt-3 grid grid-cols-4 gap-2 rounded-xl border bg-muted/40 p-3 text-xs @3xl:hidden"
        aria-label="All campaigns"
      >
        <div className="min-w-0">
          <dt className="text-muted-foreground">Spend</dt>
          <dd className="tabular mt-0.5 truncate text-sm font-semibold">
            {shortMoney(r.totals.spendMinor, c)}
          </dd>
        </div>
        {MODELS.map((m) => (
          <div key={m.key} className="min-w-0">
            <dt className="truncate text-muted-foreground">{m.label}</dt>
            <dd
              className={cn(
                "tabular mt-0.5 truncate text-sm font-semibold",
                roasTone(r.totals[m.key]),
              )}
            >
              {roas(r.totals[m.key].roas)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
