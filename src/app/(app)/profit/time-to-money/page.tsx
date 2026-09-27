import { PageBody, PageHeader } from "@/components/page-header";
import { ProfitTabs, profitQuery } from "@/components/profit/profit-tabs";
import { LagSummary, LagTable, PauseDraftsCard } from "@/components/profit/time-to-money";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resolvePeriodParams } from "@/lib/period";
import { getUnitEconomics, pauseDrafts, profitRows, timeToMoney } from "@/lib/reports-profit";

export const metadata = { title: "Time to money" };

export default async function TimeToMoneyPage({ searchParams }: PageProps<"/profit/time-to-money">) {
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const ue = await getUnitEconomics(db, ws.id);
  const [lags, rows] = await Promise.all([timeToMoney(db, ws, { asOf: p.end }), profitRows(db, ws, p, "campaign", ue)]);
  const drafts = await pauseDrafts(db, ws, p, { unitEconomics: ue, rows, lags });
  const query = profitQuery(sp);
  const csvQuery = new URLSearchParams({ start: p.start, end: p.end, model: p.model, ...(p.platform ? { platform: p.platform } : {}) });
  // Campaigns that spent in the period first, too-early ones on top.
  const spent = new Set(rows.filter((r) => r.spendMinor > 0).map((r) => r.id));
  const lagRows = lags.campaigns.filter((c) => spent.has(c.campaignId)).sort((a, b) => Number(b.tooEarly) - Number(a.tooEarly) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Time to money" description="How long buyers take to pay, and which campaigns are too young to judge">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showCompare={false} />
      </PageHeader>
      <PageBody>
        <ProfitTabs active="time" query={query} />
        <section aria-label="Summary" className="rounded-xl bg-card px-4 py-5 shadow-(--elev-card) sm:px-6 sm:py-6">
          <LagSummary lag={lags.workspace} />
        </section>
        <PauseDraftsCard
          drafts={drafts}
          currency={ws.reportingCurrency}
          canExport={user.can("reports.export")}
          csvHref={(platform) => `/api/v1/exports/pause-drafts?${new URLSearchParams({ ...Object.fromEntries(csvQuery), platform })}`}
        />
        <section aria-labelledby="lag-h" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
          <div className="px-4 pt-4 pb-3">
            <h2 id="lag-h" className="text-body font-semibold">
              Payback lag by campaign
            </h2>
            <p className="text-caption text-pretty text-muted-foreground">
              Days from a buyer&rsquo;s first click on the campaign to their first payment. Campaigns with fewer than 5 buyers borrow the lag of all your
              buyers.
            </p>
          </div>
          {lagRows.length ? (
            <LagTable rows={lagRows} />
          ) : (
            <p className="border-t px-4 py-6 text-ui text-muted-foreground">No campaign spent in this period.</p>
          )}
        </section>
      </PageBody>
    </>
  );
}
