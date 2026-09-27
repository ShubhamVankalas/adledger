import {
  ChevronRightIcon,
  CoinsIcon,
  GaugeIcon,
  HandCoinsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import {
  ChannelTable,
  CohortTable,
  ratioLabel,
} from "@/components/reports/ltv-tables";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, longDate, MODEL_LABELS, moneyKpi, moneyShort, num } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { ltv } from "@/lib/reports-advanced";

export const metadata = { title: "Customer LTV" };

export default async function LtvPage({
  searchParams,
}: PageProps<"/reports/ltv">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  // Cohorts need a few months to mean anything: default to the last 180 days.
  const p = await resolvePeriodParams(
    db,
    ws,
    sp.range || sp.from ? sp : { ...sp, range: "180d" },
  );
  const r = await ltv(db, ws, p);
  const c = ws.reportingCurrency;
  const paid = r.channels.filter((x) => x.spendMinor > 0);
  const paidRevenue = paid.reduce((s, x) => s + x.revenueMinor, 0);
  const paidSpend = paid.reduce((s, x) => s + x.spendMinor, 0);
  const blended = paidSpend > 0 ? paidRevenue / paidSpend : null;

  return (
    <>
      <PageHeader
        title="Customer LTV"
        description="What a customer is worth over time, and what it cost to acquire them"
      >
        <ReportControls
          start={p.start}
          end={p.end}
          range={p.range}
          model={p.model}
          showPlatform={false}
        />
      </PageHeader>
      <PageBody>
        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="New customers"
            value={num(r.customers)}
            icon={UsersIcon}
            sub={dateRange(p.start, p.end)}
            hint={`Customers whose first payment was between ${longDate(p.start)} and ${longDate(p.end)}.`}
          />
          <KpiCard
            label="Revenue to date"
            value={moneyKpi(r.revenueMinor, c)}
            icon={CoinsIcon}
            sub="net of refunds"
          />
          <KpiCard
            accent
            label="Average LTV"
            value={moneyKpi(r.ltvMinor, c)}
            icon={HandCoinsIcon}
            sub="per customer, to date"
          />
          <KpiCard
            label="Paid LTV:CAC"
            value={ratioLabel(blended)}
            icon={GaugeIcon}
            sub={
              paidSpend
                ? `on ${moneyShort(paidSpend, c)} ad spend`
                : "no ad spend"
            }
            hint={`Lifetime revenue of customers acquired by ad platforms (${moneyShort(paidRevenue, c)}) ÷ what those platforms cost in the same period (${moneyShort(paidSpend, c)}). 3:1 or better is healthy for most businesses.`}
          />
        </section>

        <div className="grid items-start gap-6 min-[1700px]:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cohorts by first-payment month</CardTitle>
              <CardDescription>
                Cumulative revenue per customer at the end of each month after
                their first payment (month 0 = the month they first paid).
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <CohortTable cohorts={r.cohorts} currency={c} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>LTV:CAC by acquiring channel</CardTitle>
              <CardDescription>
                Customers credited to the platform or channel that acquired them
                ({MODEL_LABELS[p.model].toLowerCase()} model), their revenue to
                date, and ad spend in the same period.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <ChannelTable channels={r.channels} currency={c} />
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl">
            Revenue is every payment minus refunds in {c} up to {longDate(p.end)}.
            Customers are counted in the month of their first payment (workspace
            timezone {ws.timezone}). CAC only exists for ad platforms with spend
            in {c}; organic, referral and unattributed customers show LTV only.
            LTV:CAC is green at 3:1 or better, amber from 1:1.
          </p>
          <Link
            href="/performance"
            className="inline-flex h-10 shrink-0 items-center gap-1 self-start rounded-lg border bg-card px-3 font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9"
          >
            Campaign performance{" "}
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </Link>
        </div>
      </PageBody>
    </>
  );
}
