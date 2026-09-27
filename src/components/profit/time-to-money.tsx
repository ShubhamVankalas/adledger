import { DownloadIcon, HourglassIcon } from "lucide-react";
import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { longDate, moneyWhole, num, plural, roas, shortDate } from "@/lib/format";
import type { LagRow, LagStats, PauseDraft, PauseDrafts } from "@/lib/reports-profit";
import { cn } from "@/lib/utils";

const days = (v: number | null) => (v === null ? "—" : v < 1 ? "< 1 day" : `${num(v, v < 10 ? 1 : 0)} days`);

/** One sentence on how long buyers take to pay, from the workspace-wide lag. */
export function LagSummary({ lag }: { lag: LagStats }) {
  if (lag.samples === 0 || lag.p50Days === null || lag.p80Days === null) {
    return (
      <p className="max-w-3xl text-title text-balance">
        No paying customers with a tracked ad click yet. Until there are, AdLedger waits a week before judging a new campaign.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="max-w-3xl text-title text-balance">
        Your buyers usually pay <span className="num">{days(lag.p50Days)}</span> after their first ad click.{" "}
        <span className="text-muted-foreground">
          80% have paid within <span className="num text-foreground">{days(lag.p80Days)}</span>.
        </span>
      </p>
      <p className="max-w-3xl text-body text-pretty text-muted-foreground">
        A campaign younger than that hasn&rsquo;t had the chance to earn its money back, so a low ROAS may only mean its buyers haven&rsquo;t paid yet.
        Based on {plural(lag.samples, "customer")} from the last 180 days.
      </p>
    </div>
  );
}

function JudgeTag({ row }: { row: LagRow }) {
  if (row.tooEarly) {
    return (
      <Badge variant="warning" title={`Buyers of this campaign need about ${row.judgeAfterDays} days to pay`}>
        <HourglassIcon aria-hidden /> Too early{row.judgeFrom ? ` until ${shortDate(row.judgeFrom)}` : ""}
      </Badge>
    );
  }
  return <Badge variant="secondary">Ready to judge</Badge>;
}

const BASIS: Record<LagRow["basis"], string> = { campaign: "its own buyers", workspace: "all buyers", default: "default (7 days)" };

/** Per-campaign payback lag and whether it's old enough to judge. */
export function LagTable({ rows }: { rows: LagRow[] }) {
  return (
    <div role="region" aria-label="Payback lag by campaign" tabIndex={0} className="overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <table className="w-full min-w-[46rem] text-ui">
        <thead>
          <tr className="border-y text-caption text-muted-foreground">
            <th scope="col" className="sticky left-0 z-[1] bg-card py-2 pr-3 pl-4 text-left font-medium">
              Campaign
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Running since</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Buyers</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Median lag</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">80% paid by</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Judged on</th>
            <th scope="col" className="py-2 pr-4 pl-3 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.campaignId} className="group/row hover:bg-fill">
              <th scope="row" className="sticky left-0 z-[1] max-w-[18rem] bg-card py-2 pr-3 pl-4 text-left font-normal group-hover/row:bg-fill">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformBadge platform={r.platform} compact className="text-foreground" />
                  <span className="truncate font-medium" title={r.name}>
                    {r.name}
                  </span>
                </span>
              </th>
              <td className="num px-3 py-2 text-muted-foreground">
                {r.firstSpendDate ? `${longDate(r.firstSpendDate)} · ${plural(r.ageDays ?? 0, "day")}` : "—"}
              </td>
              <td className="num px-3 py-2 text-right">{num(r.own.samples)}</td>
              <td className="num px-3 py-2 text-right">{days(r.own.p50Days)}</td>
              <td className="num px-3 py-2 text-right">{days(r.own.p80Days)}</td>
              <td className="px-3 py-2 text-muted-foreground">{BASIS[r.basis]}</td>
              <td className="py-2 pr-4 pl-3 text-right">
                <JudgeTag row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DraftRow({ d, metric, currency, early }: { d: PauseDraft; metric: "poas" | "roas"; currency: string; early?: boolean }) {
  const value = metric === "poas" ? d.poas : d.roas;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <PlatformBadge platform={d.platform} compact className="text-foreground" />
        <span className="truncate font-medium" title={d.name}>
          {d.name}
        </span>
      </span>
      <span className={cn("num text-right font-medium", !early && "text-negative")}>
        {roas(value)} <span className="text-caption font-normal text-muted-foreground">{metric.toUpperCase()}</span>
      </span>
      <span className="num col-span-2 text-caption text-muted-foreground">
        {moneyWhole(d.spendMinor, currency)} spent · {moneyWhole(metric === "poas" ? d.contributionMinor : d.revenueMinor, currency)}{" "}
        {metric === "poas" ? "contribution" : "revenue"} back
        {early ? ` · ${plural(d.ageDays ?? 0, "day")} old, buyers need ${plural(d.judgeAfterDays, "day")}` : ""}
      </span>
    </li>
  );
}

/**
 * Campaigns worth pausing, as drafts only: the owner downloads a bulk-edit file and imports it
 * in Ads Manager or Google Ads Editor. AdLedger never changes a campaign itself.
 */
export function PauseDraftsCard({ drafts: d, currency, csvHref, canExport }: { drafts: PauseDrafts; currency: string; csvHref: (platform: "meta" | "google") => string; canExport: boolean }) {
  const byPlatform = (p: string) => d.drafts.filter((x) => x.platform === p).length;
  const threshold = roas(d.threshold);
  return (
    <section aria-labelledby="drafts-h" className="rounded-xl bg-card px-4 py-4 shadow-(--elev-card) sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="drafts-h" className="text-body font-semibold">
            Pause drafts
          </h2>
          <p className="text-caption text-pretty text-muted-foreground">
            Running campaigns with at least {moneyWhole(d.minSpendMinor, currency)} spend that returned under {threshold}{" "}
            {d.metric === "poas" ? "in contribution (POAS)" : "in revenue (ROAS)"} and are old enough to judge. Nothing changes until you import the file
            yourself.
          </p>
        </div>
        {canExport && d.drafts.length ? (
          <div className="flex flex-wrap gap-2">
            {byPlatform("meta") ? (
              <Button variant="outline" size="sm" render={<a href={csvHref("meta")} download />}>
                <DownloadIcon aria-hidden /> Meta bulk file ({byPlatform("meta")})
              </Button>
            ) : null}
            {byPlatform("google") ? (
              <Button variant="outline" size="sm" render={<a href={csvHref("google")} download />}>
                <DownloadIcon aria-hidden /> Google Ads Editor file ({byPlatform("google")})
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {d.drafts.length ? (
        <ul className="mt-2 divide-y divide-border">
          {d.drafts.map((x) => (
            <DraftRow key={x.campaignId} d={x} metric={d.metric} currency={currency} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-ui text-muted-foreground">No campaign qualifies right now. Everything with real spend is returning at least {threshold}.</p>
      )}
      {d.drafts.some((x) => x.platform !== "meta" && x.platform !== "google") ? (
        <p className="mt-2 text-caption text-muted-foreground">Other platforms have no bulk file yet: pause those in their own ads manager.</p>
      ) : null}
      {d.tooEarly.length ? (
        <div className="mt-4 border-t pt-3">
          <h3 className="flex items-center gap-1.5 text-ui font-medium">
            <HourglassIcon aria-hidden className="size-3.5 text-warning" /> Too early to judge
          </h3>
          <p className="text-caption text-muted-foreground">These look like losers, but their buyers haven&rsquo;t had time to pay. They&rsquo;re left out of the file.</p>
          <ul className="divide-y divide-border">
            {d.tooEarly.map((x) => (
              <DraftRow key={x.campaignId} d={x} metric={d.metric} currency={currency} early />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
