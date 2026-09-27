import { CalendarClockIcon, CoinsIcon, HandCoinsIcon, TimerIcon, WalletIcon } from "lucide-react";
import { Suspense } from "react";
import { LtvCurveChart, type LtvCurveSeries } from "@/components/analysis/ltv-curve-chart";
import { PaybackTable } from "@/components/analysis/payback-table";
import { Answer, Num, Panel, PanelEmpty, stepLabel } from "@/components/analysis/primitives";
import { SectionTabs } from "@/components/analysis/section-tabs";
import { CUSTOMERS_TABS, SectionTabsStatic } from "@/components/analysis/tabs";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, longDate, MODEL_LABELS, moneyKpi, moneyShort, plural } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { paybackByChannel } from "@/lib/reports-analysis";

export const metadata = { title: "Payback" };

const days = (d: number | null) => (d === null ? "—" : d === 0 ? "Day 0" : plural(d, "day"));
/** "on the first purchase" / "after 35 days", for sentences. */
const when = (d: number | null) => (d === 0 ? "on the first purchase" : `after ${days(d)}`);

export default async function PaybackPage({ searchParams }: PageProps<"/customers/payback">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "180d" });
  const r = await paybackByChannel(db, ws, p);
  const c = ws.reportingCurrency;
  const paid = r.paid;
  const platforms = r.rows.filter((x) => x.spendMinor > 0 && x.customers > 0);
  const fastest = platforms.filter((x) => x.paybackDays !== null).sort((a, b) => a.paybackDays! - b.paybackDays!)[0];
  const behind = platforms.filter((x) => x.status === "not_yet");
  const series: LtvCurveSeries[] = [
    ...(platforms.length > 1 ? [{ key: "__paid", label: "All paid", points: paid.curve, cacMinor: paid.cacMinor, paybackDays: paid.paybackDays }] : []),
    ...r.rows
      .filter((x) => x.customers > 0 && x.curve.some((pt) => pt.ltvMinor !== null))
      .slice(0, 6)
      .map((x) => ({ key: x.key, label: stepLabel(x.key), points: x.curve, cacMinor: x.cacMinor, paybackDays: x.paybackDays })),
  ];

  return (
    <>
      <PageHeader title="Customers" description="When the customers each channel brings in pay back what they cost">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showCompare={false} />
      </PageHeader>
      <PageBody>
        <Suspense fallback={<SectionTabsStatic tabs={CUSTOMERS_TABS} active="/customers/payback" label="Customer views" />}>
          <SectionTabs tabs={CUSTOMERS_TABS} label="Customer views" />
        </Suspense>

        <Answer>
          {paid.customers === 0 ? (
            <>No customers were acquired by ad platforms with spend between {dateRange(p.start, p.end)}. Try a longer date range or another model.</>
          ) : paid.status === "paid_back" ? (
            <>
              Customers from ads pay back their <Num>{moneyShort(paid.cacMinor, c)}</Num> acquisition cost <Num>{when(paid.paybackDays)}</Num> on average
              {fastest && platforms.length > 1 ? (
                <>
                  ; <Num>{stepLabel(fastest.key)}</Num> is fastest, <Num>{when(fastest.paybackDays)}</Num>
                </>
              ) : null}
              .{behind.length ? <> {behind.map((x) => stepLabel(x.key)).join(", ")} {behind.length === 1 ? "has" : "have"} not paid back yet.</> : null}
            </>
          ) : (
            <>
              Customers from ads have not yet paid back their <Num>{moneyShort(paid.cacMinor, c)}</Num> acquisition cost: they are worth{" "}
              <Num>{moneyShort(paid.ltvToDateMinor, c)}</Num> each so far.
              {fastest ? (
                <>
                  {" "}
                  <Num>{stepLabel(fastest.key)}</Num> has, <Num>{when(fastest.paybackDays)}</Num>.
                </>
              ) : null}
            </>
          )}
        </Answer>

        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Paid CAC"
            value={moneyKpi(paid.cacMinor, c)}
            icon={WalletIcon}
            sub={`${moneyShort(paid.spendMinor, c)} spend`}
            goodWhenUp={false}
            hint="Ad spend on every platform with spend in the period, divided by the customers those platforms acquired (credited with the selected model)."
          />
          <KpiCard label="Payback" value={days(paid.paybackDays)} icon={TimerIcon} sub={paid.status === "not_yet" ? "not reached yet" : paid.paybackDays === 0 ? "covered by the first purchase" : "after the first payment"} />
          <KpiCard
            label="LTV at 90 days"
            value={moneyKpi(paid.ltvAt[90], c)}
            icon={HandCoinsIcon}
            sub={paid.ltvAt[90] === null ? "too early to tell" : "per paid customer"}
            hint="Net revenue per customer in their first 90 days, over customers acquired at least 90 days before the end of the period."
          />
          <KpiCard label="LTV to date" value={moneyKpi(paid.ltvToDateMinor, c)} icon={CoinsIcon} sub="per paid customer" />
        </section>

        <Panel
          id="curve"
          title="Revenue per customer over time"
          description="Cumulative net revenue per customer by days since their first payment. The curve crossing the dashed CAC line is the payback day."
        >
          {series.length === 0 ? (
            <PanelEmpty icon={CalendarClockIcon} title="No customers to follow yet">
              The curve fills in as customers acquired in this period keep paying.
            </PanelEmpty>
          ) : (
            <LtvCurveChart series={series} currency={c} />
          )}
        </Panel>

        <Panel
          id="sources"
          title="Payback by acquisition source"
          description={<>Customers credited to the platform or channel that acquired them ({MODEL_LABELS[p.model].toLowerCase()} model). CAC is that platform&apos;s spend in the period.</>}
          bodyClassName="px-0 sm:px-4"
        >
          {r.rows.length === 0 ? (
            <PanelEmpty icon={CoinsIcon} title="No customers or spend in this period" />
          ) : (
            <div className="px-4 sm:px-0">
              <PaybackTable report={r} currency={c} />
            </div>
          )}
        </Panel>

        <p className="max-w-3xl border-t pt-4 text-caption text-muted-foreground">
          The value at day 30, 60, 90 or 180 counts only customers whose first payment was at least that long before {longDate(p.end)} (or today), so young customers never
          drag it down; &ldquo;—&rdquo; means nobody is that old yet. Linear credit splits a customer across the platforms that touched them. Revenue is payments minus refunds in {c}.
        </p>
      </PageBody>
    </>
  );
}
