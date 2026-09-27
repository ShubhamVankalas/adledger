import {
  ChevronRightIcon,
  FlagIcon,
  MegaphoneIcon,
  RocketIcon,
  ScaleIcon,
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { ModelComparisonTable } from "@/components/reports/model-comparison-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { moneyDelta, moneyKpi, moneyShort, num, plural, roas } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { modelComparison, ROLE_THRESHOLD } from "@/lib/reports-advanced";

export const metadata = { title: "Model comparison" };

export default async function ModelComparisonPage({
  searchParams,
}: PageProps<"/reports/models">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const p = await resolvePeriodParams(db, ws, await searchParams);
  const r = await modelComparison(db, ws, p);
  const c = ws.reportingCurrency;
  const starters = r.rows.filter((x) => x.role === "starter");
  const closers = r.rows.filter((x) => x.role === "closer");
  const sumFirst = (rows: typeof r.rows) =>
    rows.reduce((s, x) => s + x.firstTouch.revenueMinor, 0);
  const sumLast = (rows: typeof r.rows) =>
    rows.reduce((s, x) => s + x.lastTouch.revenueMinor, 0);
  const starterGain = sumFirst(starters) - sumLast(starters);
  const closerGain = sumLast(closers) - sumFirst(closers);

  return (
    <>
      <PageHeader
        title="Model comparison"
        description="How first-touch, last-touch and linear credit change each campaign's revenue"
      >
        <ReportControls
          start={p.start}
          end={p.end}
          range={p.range}
          model={p.model}
          platform={p.platform}
          showModel={false}
        />
      </PageHeader>
      <PageBody>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Campaign spend"
            value={moneyKpi(r.totals.spendMinor, c)}
            goodWhenUp={null}
            icon={MegaphoneIcon}
            sub={plural(r.rows.length, "campaign")}
          />
          <KpiCard
            label="Linear ROAS"
            value={roas(r.totals.linear.roas)}
            icon={ScaleIcon}
            accent
            sub={`first ${roas(r.totals.firstTouch.roas)} · last ${roas(r.totals.lastTouch.roas)}`}
            hint="Revenue credited to campaigns ÷ campaign spend. Totals move between models only when some touches in a journey are not from campaigns (organic, email, direct…)."
          />
          <KpiCard
            label="Journey starters"
            value={num(starters.length)}
            icon={RocketIcon}
            sub={
              starters.length
                ? `${moneyDelta(starterGain, c)} on first touch`
                : "none this period"
            }
            hint={`Campaigns credited clearly more under first-touch than last-touch (${moneyShort(sumFirst(starters), c)} vs ${moneyShort(sumLast(starters), c)}): they introduce people who later convert through something else. Judging them on last-touch undervalues them.`}
          />
          <KpiCard
            label="Journey closers"
            value={num(closers.length)}
            icon={FlagIcon}
            sub={
              closers.length
                ? `${moneyDelta(closerGain, c)} on last touch`
                : "none this period"
            }
            hint={`Campaigns credited clearly more under last-touch (${moneyShort(sumLast(closers), c)} vs ${moneyShort(sumFirst(closers), c)} first-touch): they catch people who were already on their way (brand search, retargeting).`}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Revenue and ROAS by attribution model</CardTitle>
            <CardDescription>
              The bar shows first-touch minus last-touch revenue. A campaign
              starts or closes journeys when the gap is at least{" "}
              {Math.round(ROLE_THRESHOLD * 100)}% of the larger value.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <ModelComparisonTable report={r} currency={c} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl">
            Bars left of centre earn more under last touch (closers); bars right
            of centre earn more under first touch (starters). Revenue is
            credited within a {ws.attributionWindowDays}-day window in {c};
            repeat payments inherit the journey that acquired the customer.
          </p>
          <Link
            href="/performance"
            className="inline-flex h-10 shrink-0 items-center gap-1 self-start rounded-lg border bg-card md:h-9 px-3 font-medium text-foreground transition-colors hover:bg-muted"
          >
            Campaign performance{" "}
            <ChevronRightIcon aria-hidden className="size-3.5" />
          </Link>
        </div>
      </PageBody>
    </>
  );
}
