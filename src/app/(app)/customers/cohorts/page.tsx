import { CalendarRangeIcon, HandCoinsIcon, RepeatIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { Suspense } from "react";
import { CohortHeatmap, type CohortView } from "@/components/analysis/cohort-heatmap";
import { Answer, monthLabel, Num, Panel, PanelEmpty } from "@/components/analysis/primitives";
import { SectionTabs } from "@/components/analysis/section-tabs";
import { CUSTOMERS_TABS, SectionTabsStatic } from "@/components/analysis/tabs";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, longDate, moneyKpi, num, pct, plural } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { cohortAverages, cohortRetention } from "@/lib/reports-analysis";

export const metadata = { title: "Cohorts" };

export default async function CohortsPage({ searchParams }: PageProps<"/customers/cohorts">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  // Cohorts need months to mean anything: default to the last 180 days.
  const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "180d" });
  const r = await cohortRetention(db, ws, p);
  const avg = cohortAverages(r);
  const c = ws.reportingCurrency;
  const view: CohortView = sp.view === "ltv" || sp.view === "revenue" ? sp.view : "retention";
  const withCac = r.cohorts.filter((x) => x.cacMinor !== null && x.customers > 0);
  const paidBack = withCac.filter((x) => x.paybackMonth !== null);
  const firstMonth = paidBack.filter((x) => x.paybackMonth === 0).length;
  const fastest = paidBack.reduce<(typeof paidBack)[number] | null>((best, x) => (best === null || x.paybackMonth! < best.paybackMonth! ? x : best), null);

  return (
    <>
      <PageHeader title="Customers" description="How each month's new customers keep paying">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} showPlatform={false} showModel={false} showCompare={false} />
      </PageHeader>
      <PageBody>
        <Suspense fallback={<SectionTabsStatic tabs={CUSTOMERS_TABS} active="/customers/cohorts" label="Customer views" />}>
          <SectionTabs tabs={CUSTOMERS_TABS} label="Customer views" />
        </Suspense>

        <Answer>
          {r.customers === 0 ? (
            <>No first-time customers between {dateRange(p.start, p.end)}. Try a longer date range.</>
          ) : (
            <>
              {r.month1Retention !== null ? (
                <>
                  <Num>{pct(r.month1Retention, 0)}</Num> of new customers pay again the month after their first purchase, and{" "}
                </>
              ) : null}
              <Num>{pct(r.repeatRate, 0)}</Num> have paid more than once so far.{" "}
              {withCac.length === 0 ? null : fastest ? (
                <>
                  {paidBack.length} of {plural(withCac.length, "cohort")} with ad spend {paidBack.length === 1 ? "has" : "have"} paid back their acquisition cost
                  {firstMonth > 0 ? (
                    <>
                      , <Num>{firstMonth === paidBack.length && firstMonth > 1 ? "all" : num(firstMonth)}</Num> within their first month.
                    </>
                  ) : (
                    <>
                      , fastest {monthLabel(fastest.cohort)} after <Num>{plural(fastest.paybackMonth!, "month")}</Num>.
                    </>
                  )}
                </>
              ) : (
                <>No cohort has paid back its acquisition cost yet.</>
              )}
            </>
          )}
        </Answer>

        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="New customers" value={num(r.customers)} icon={UserPlusIcon} sub={plural(r.cohorts.length, "monthly cohort")} />
          <KpiCard
            label="Month 1 retention"
            value={pct(r.month1Retention, 0)}
            icon={CalendarRangeIcon}
            sub="pay again next month"
            hint="Share of new customers who paid again in the calendar month after their first payment, over cohorts that have reached that month."
          />
          <KpiCard label="Repeat rate" value={pct(r.repeatRate, 0)} icon={RepeatIcon} sub="2+ payments to date" />
          <KpiCard label="LTV to date" value={moneyKpi(r.ltvMinor, c)} icon={HandCoinsIcon} sub="net revenue per customer" />
        </section>

        <Panel id="cohorts" title="Cohorts by first-payment month" description={`Customers grouped by the month they first paid (${ws.timezone}), followed month by month.`}>
          {r.customers === 0 ? (
            <PanelEmpty icon={UsersIcon} title="No new customers in this period">
              Cohorts appear once payments come in. Connect Stripe or send payments through the API.
            </PanelEmpty>
          ) : (
            <CohortHeatmap report={r} average={avg} currency={c} initialView={view} />
          )}
        </Panel>

        <p className="max-w-3xl border-t pt-4 text-caption text-muted-foreground">
          Revenue is payments minus refunds in {c} up to {longDate(p.end)}. CAC is all ad spend in the cohort&apos;s month divided by its new customers, so it is a blended cost that
          includes organic buyers. A cohort pays back in the first month where its cumulative revenue per customer reaches that CAC.
        </p>
      </PageBody>
    </>
  );
}
