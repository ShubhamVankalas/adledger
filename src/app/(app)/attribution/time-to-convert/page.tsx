import { ArrowRightIcon, ClockIcon, HourglassIcon, LaptopIcon, MousePointerClickIcon, TimerIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { CampaignLagTable } from "@/components/analysis/campaign-lag-table";
import { HeatmapGrid } from "@/components/analysis/heatmap";
import { LagHistogram } from "@/components/analysis/histogram";
import { Answer, daysLabel, Num, Panel, PanelEmpty } from "@/components/analysis/primitives";
import { SectionTabs } from "@/components/analysis/section-tabs";
import { ATTRIBUTION_TABS, SectionTabsStatic } from "@/components/analysis/tabs";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, num, pct, plural } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { conversionsHeatmap, MIN_FOR_RECOMMENDATION, timeToConvert, TOUCH_BUCKETS } from "@/lib/reports-analysis";

export const metadata = { title: "Time to convert" };

export default async function TimeToConvertPage({ searchParams }: PageProps<"/attribution/time-to-convert">) {
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "90d" });
  const [r, heat] = await Promise.all([timeToConvert(db, ws, p), conversionsHeatmap(db, ws, p)]);
  const win = r.windowDays;
  const tp = r.touchToPayment;
  const rec = r.recommendedWindowDays;
  // Recommend a change only when the window misses buyers, or is far longer than anyone needs.
  const recommend = rec !== null && (rec > win || rec <= win / 2);
  const canEdit = user.can("workspace.settings");
  const maxTouch = Math.max(1, ...r.touches.buckets);

  return (
    <>
      <PageHeader title="Attribution" description="How long people take to buy after the first ad or visit">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showModel={false} />
      </PageHeader>
      <PageBody>
        <Suspense fallback={<SectionTabsStatic tabs={ATTRIBUTION_TABS} active="/attribution/time-to-convert" label="Attribution views" />}>
          <SectionTabs tabs={ATTRIBUTION_TABS} label="Attribution views" />
        </Suspense>

        <Answer>
          {tp.conversions === 0 ? (
            <>No tracked customers bought between {dateRange(p.start, p.end)}. Try a longer date range.</>
          ) : (
            <>
              Half of your tracked customers buy within <Num>{daysLabel(tp.medianDays)}</Num> of their first visit, and 90% within <Num>{daysLabel(tp.p90Days)}</Num>. Your
              attribution window is <Num>{plural(win, "day")}</Num>
              {tp.withinWindowShare !== null && tp.withinWindowShare < 0.9 ? (
                <>
                  , so <Num className="text-warning-foreground">{pct(1 - tp.withinWindowShare, 0)}</Num> of purchases happen after it closes.
                </>
              ) : (
                <>, which covers {pct(tp.withinWindowShare, 0)} of them.</>
              )}
            </>
          )}
        </Answer>

        {recommend && rec !== null ? (
          <div className="flex flex-col gap-3 rounded-xl bg-brand-soft px-4 py-3 text-body sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2.5">
              <HourglassIcon aria-hidden strokeWidth={1.75} className="mt-[3px] size-4 shrink-0 text-brand" />
              <span>
                <span className="font-medium">Recommended window: {plural(rec, "day")}.</span>{" "}
                <span className="text-muted-foreground">
                  90% of customers buy within {daysLabel(tp.p90Days)} of the first touch; your window is {plural(win, "day")}.{" "}
                  {rec > win ? "A longer window credits the ads that start slow journeys." : "A shorter window stops old clicks taking credit."}
                </span>
              </span>
            </p>
            {canEdit ? (
              <Link
                href="/settings/workspace#ws-window"
                className="inline-flex h-9 shrink-0 items-center gap-1 self-start rounded-md bg-primary px-3 text-ui font-medium text-primary-foreground transition-[background-color,transform] duration-100 hover:bg-primary/90 active:scale-[0.97] sm:self-auto md:h-8"
              >
                Change window <ArrowRightIcon aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Median to buy" value={daysLabel(tp.medianDays)} icon={TimerIcon} sub={`first touch → payment · ${plural(tp.conversions, "customer")}`} />
          <KpiCard
            label="90% buy within"
            value={daysLabel(tp.p90Days)}
            icon={ClockIcon}
            sub={`window ${plural(win, "day")}`}
            hint={`90% of tracked customers paid within this long of their first tracked touch. ${rec === null ? `The recommendation needs at least ${MIN_FOR_RECOMMENDATION} customers.` : ""}`}
          />
          <KpiCard
            label="Touches to buy"
            value={r.touches.avg === null ? "—" : num(r.touches.avg, 1)}
            icon={MousePointerClickIcon}
            sub="average, in the window"
            hint="Average number of tracked touches (ad clicks and visits) in the attribution window before the first payment."
          />
          <KpiCard
            label="Cross-device"
            value={pct(r.crossDeviceShare, 0)}
            icon={LaptopIcon}
            sub="journeys on 2+ browsers"
            hint="Share of tracked customers whose touches came from more than one browser or device before they bought, stitched together by email."
          />
        </section>

        <Panel
          id="lags"
          title="How long each step takes"
          description={<>Each person&apos;s first touch, first lead and first payment. Faded columns fall outside your {win}-day window: those conversions get no ad credit.</>}
        >
          <div className="grid gap-x-8 gap-y-8 md:grid-cols-3">
            {(
              [
                { title: "First touch → lead", stats: r.touchToLead, color: "var(--chart-leads)", one: "lead", many: "leads", need: "leads with a tracked touch before" },
                { title: "Lead → payment", stats: r.leadToPayment, color: "var(--chart-customers)", one: "customer", many: "customers", need: "customers who were leads first" },
                { title: "First touch → payment", stats: r.touchToPayment, color: "var(--chart-revenue)", one: "customer", many: "customers", need: "customers with a tracked touch" },
              ] as const
            ).map(({ title, stats, color, one, many, need }) => (
              <div key={title} className="min-w-0">
                <h3 className="flex items-baseline justify-between gap-2 text-ui font-medium">
                  {title}
                  <span className="text-caption font-normal text-muted-foreground tabular-nums">{plural(stats.conversions, one, many)}</span>
                </h3>
                <div className="mt-3">
                  {stats.conversions ? (
                    <LagHistogram stats={stats} windowDays={win} color={color} label={title} />
                  ) : (
                    <PanelEmpty icon={TimerIcon} title="No data yet" className="py-12">
                      Needs {need} in this period.
                    </PanelEmpty>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid items-start gap-4 lg:grid-cols-12">
          <Panel
            className="lg:col-span-7"
            id="heatmap"
            title="When people convert"
            description={<>Leads and payments by day of week and hour, in {ws.timezone}. Useful for call staffing and ad scheduling.</>}
          >
            <HeatmapGrid data={heat} />
          </Panel>
          <Panel className="lg:col-span-5" id="touches" title="Touches before buying" description={`Tracked customers by the number of touches in the ${win}-day window.`}>
            {r.touches.tracked === 0 ? (
              <PanelEmpty icon={MousePointerClickIcon} title="No tracked customers">
                Customers appear here once their visits come through the pixel.
              </PanelEmpty>
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Customers by number of touches">
                {TOUCH_BUCKETS.map((b, i) => {
                  const v = r.touches.buckets[i];
                  return (
                    <li key={b} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-ui">
                      <span className="whitespace-nowrap text-muted-foreground">
                        {b} {b === "1" ? "touch" : "touches"}
                      </span>
                      <span className="h-2 overflow-hidden rounded-[4px] bg-fill" aria-hidden>
                        <span className="block h-full rounded-[4px] bg-brand" style={{ width: `${v ? Math.max(2, (v / maxTouch) * 100) : 0}%` }} />
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="font-medium">{num(v)}</span> <span className="text-caption text-muted-foreground">{pct(v / r.touches.tracked, 0)}</span>
                      </span>
                    </li>
                  );
                })}
                <li className="mt-1 border-t pt-3 text-caption text-muted-foreground">
                  {num(r.touches.customers - r.touches.tracked)} of {plural(r.touches.customers, "customer")} had no tracked touch in the window.
                </li>
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          id="campaigns"
          title="Time to convert by campaign"
          description="From each campaign's first touch in the window to the purchase. Slow campaigns need longer before you judge their ROAS."
          bodyClassName="px-0 sm:px-4"
        >
          {r.campaigns.length === 0 ? (
            <PanelEmpty icon={TimerIcon} title="No campaign conversions in this period">
              Campaigns appear once someone who clicked an ad becomes a lead or pays.
            </PanelEmpty>
          ) : (
            <div className="px-4 sm:px-0">
              <CampaignLagTable rows={r.campaigns} windowDays={win} />
            </div>
          )}
        </Panel>

        <p className="max-w-3xl border-t pt-4 text-caption text-muted-foreground">
          Step times use each person&apos;s first-ever tracked touch, first lead and first payment, even outside the window, so you can see journeys the window misses. Touches,
          cross-device share and campaign times count only the {win} days before converting, like attribution. Times are in {ws.timezone}.
        </p>
      </PageBody>
    </>
  );
}
