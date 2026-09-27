import { desc, eq } from "drizzle-orm";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  CoinsIcon,
  HandCoinsIcon,
  MegaphoneIcon,
  SparklesIcon,
  TargetIcon,
  TrendingUpIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { SpendRevenueChart } from "@/components/charts/spend-revenue-chart";
import { KpiCard } from "@/components/kpi-card";
import { Markdown } from "@/components/markdown";
import { Onboarding, Welcome, getSetupStatus, isFreshWorkspace } from "@/components/onboarding";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { ReportControls } from "@/components/report-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { CHANNEL_LABELS, MODEL_LABELS, countLabel, credit, dateRange, delta, moneyKpi, moneyShort, pct, reportSourceLabel, roas } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { channels, overview, performance, platforms, previousPeriod, timeseries, wastedSpend } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview" };

/** Card-header link: a 36px tap target on phones, compact from `sm` up. */
const headerLink = "h-9 px-3 sm:h-7 sm:px-2.5";
/** List rows are links: comfortable tap height on phones, a hover wash on desktop. */
const rowLink = "-mx-2 rounded-lg px-2 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const p = await resolvePeriodParams(db, ws, await searchParams);
  const [cur, prev, series, camps, ch, waste, [latest], setup, plats] = await Promise.all([
    overview(db, ws, p),
    overview(db, ws, previousPeriod(p)),
    timeseries(db, ws, p),
    performance(db, ws, { ...p, level: "campaign" }),
    channels(db, ws, p),
    wastedSpend(db, ws, { ...p, level: "campaign" }),
    db.select().from(schema.aiReports).where(eq(schema.aiReports.workspaceId, ws.id)).orderBy(desc(schema.aiReports.createdAt)).limit(1),
    getSetupStatus(db, ws),
    platforms(db, ws, p),
  ]);
  const c = ws.reportingCurrency;
  const top = [...camps].sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, 6);
  const maxRoas = Math.max(1, ...top.map((t) => t.roas ?? 0));
  const channelTotal = ch.reduce((s, r) => s + Math.max(0, r.revenueMinor), 0);
  const wasteTotal = waste.reduce((s, r) => s + r.spendMinor, 0);
  const empty = cur.spendMinor === 0 && cur.revenueMinor === 0 && cur.leads === 0;

  const period = { range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) };
  const perfHref = (extra: Record<string, string> = {}) => `/performance?${new URLSearchParams({ ...extra, ...period })}`;
  const campaignHref = (id: string) => perfHref({ level: "ad_group", parent: id });

  // Brand-new workspace with nothing connected: a welcome beats a dashboard full of zeros.
  if (!ws.isDemo && isFreshWorkspace(setup)) {
    return (
      <>
        <PageHeader title="Overview" description="Which ads actually made you money" />
        <PageBody>
          <Welcome status={setup} name={ws.name} canSetup={user.can("workspace.settings")} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Overview" description="Which ads actually made you money">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} />
      </PageHeader>
      <PageBody>
        {!ws.isDemo && !setup.complete ? <Onboarding status={setup} canSetup={user.can("workspace.settings")} /> : null}

        {cur.warnings.map((w) => (
          <div key={w} role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" /> {w}
          </div>
        ))}

        {/* 2 columns on phones, 3 on tablets/narrow desktops, one row of 6 when there is room. */}
        <section aria-label="Key metrics" className="@container">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-6">
            <KpiCard label="Ad spend" value={moneyKpi(cur.spendMinor, c)} delta={delta(cur.spendMinor, prev.spendMinor)} goodWhenUp={null} icon={MegaphoneIcon} sub="vs prev. period" />
            <KpiCard label="Revenue" value={moneyKpi(cur.revenueMinor, c)} delta={delta(cur.revenueMinor, prev.revenueMinor)} icon={CoinsIcon} sub={`${moneyShort(cur.attributedRevenueMinor, c)} from ads`} />
            <KpiCard
              accent
              label="ROAS"
              value={roas(cur.roas)}
              delta={delta(cur.roas, prev.roas)}
              icon={TrendingUpIcon}
              sub={`blended ${roas(cur.blendedRoas)}`}
              hint="Revenue attributed to ads ÷ ad spend, using the selected attribution model. Blended = all revenue ÷ ad spend."
            />
            <KpiCard label="Leads" value={credit(cur.leads)} delta={delta(cur.leads, prev.leads)} icon={UserPlusIcon} sub={`CPL ${moneyKpi(cur.cplMinor, c)}`} />
            <KpiCard label="Customers" value={credit(cur.customers)} delta={delta(cur.customers, prev.customers)} icon={HandCoinsIcon} sub={`CAC ${moneyKpi(cur.cacMinor, c)}`} />
            <KpiCard
              label="Unattributed"
              value={pct(cur.unattributedShare)}
              icon={TargetIcon}
              goodWhenUp={false}
              delta={delta(cur.unattributedShare, prev.unattributedShare)}
              sub={moneyShort(cur.unattributedRevenueMinor, c)}
              hint="Revenue from people with no tracked marketing touchpoint in the attribution window. Lower is better — install the pixel everywhere and pass the visitor ID to checkout."
            />
          </div>
        </section>

        {/*
          Phones and tablets: one column in reading order (chart → wasted spend → top campaigns → channels → platforms → insight).
          The two column wrappers are `display: contents` until xl, so `order-*` interleaves their cards; from xl up they become
          a main column (chart, campaigns, insight) and a side column (wasted spend, channels, platforms).
        */}
        <div className="flex flex-col gap-4 md:gap-6 lg:grid lg:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
            <Card className="order-1 lg:col-span-2">
              <CardHeader>
                <CardTitle>Spend vs revenue</CardTitle>
                <CardDescription>Daily ad spend against revenue credited to ads</CardDescription>
                <CardAction>
                  <Badge variant="outline" className="text-muted-foreground">
                    {MODEL_LABELS[p.model] ?? p.model}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="px-2 sm:px-4">
                {empty ? (
                  <div className="flex h-[220px] flex-col items-center justify-center gap-2 px-6 text-center sm:h-[280px]">
                    <ChartNoAxesColumnIcon className="size-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium">No spend or revenue in this period</p>
                    <p className="max-w-xs text-xs text-muted-foreground">Try a longer date range, or connect an ad platform and payments to start filling this chart.</p>
                  </div>
                ) : (
                  <SpendRevenueChart data={series} currency={c} />
                )}
              </CardContent>
            </Card>

            <Card className="order-3 lg:col-span-2">
              <CardHeader>
                <CardTitle>Top campaigns by revenue</CardTitle>
                <CardDescription>Revenue credited to each campaign and its return on ad spend</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" className={headerLink} render={<Link href={perfHref()} />}>
                    All <span className="max-sm:sr-only">campaigns</span> <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="@container">
                {top.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Connect Meta, Google Ads or another ad platform to see campaigns here.</p>
                ) : (
                  <>
                    <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_9rem] gap-x-4 text-[11px] @4xl:grid-cols-[minmax(0,1fr)_6rem_6rem_14rem] font-medium tracking-wide text-muted-foreground uppercase @xl:grid">
                      <span>Campaign</span>
                      <span className="text-right">Revenue</span>
                      <span className="text-right">Spend</span>
                      <span className="text-right">ROAS</span>
                    </div>
                    <ol className="space-y-0.5">
                      {top.map((t) => (
                        <li key={t.id}>
                          <Link
                            href={campaignHref(t.id)}
                            className={cn(
                              rowLink,
                              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 @xl:min-h-11 @xl:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_9rem] @xl:gap-x-4 @xl:py-2 @4xl:grid-cols-[minmax(0,1fr)_6rem_6rem_14rem]",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <PlatformBadge platform={t.platform} compact />
                              <span className="truncate text-sm font-medium" title={t.name}>
                                {t.name}
                              </span>
                            </span>
                            <span className="tabular text-right text-sm font-semibold">{moneyShort(t.revenueMinor, c)}</span>
                            <span className="tabular hidden text-right text-sm text-muted-foreground @xl:block">{moneyShort(t.spendMinor, c)}</span>
                            <span className="col-span-2 flex items-center gap-2.5 @xl:col-span-1">
                              <span className="tabular w-24 shrink-0 text-xs text-muted-foreground @xl:hidden">spend {moneyShort(t.spendMinor, c)}</span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <span
                                  className={cn("block h-full rounded-full", (t.roas ?? 0) >= 1 ? "bg-success" : "bg-destructive/70")}
                                  style={{ width: `${Math.max(2, Math.min(100, ((t.roas ?? 0) / maxRoas) * 100))}%` }}
                                />
                              </span>
                              <span className={cn("tabular w-12 text-right text-xs font-semibold", (t.roas ?? 0) < 1 && "text-destructive")}>{roas(t.roas)}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="order-6 bg-gradient-to-br from-primary/[0.07] to-card ring-primary/25">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SparklesIcon className="size-4 text-primary" /> Latest insight
                </CardTitle>
                <CardDescription>{latest ? `${dateRange(latest.periodStart, latest.periodEnd)} · ${reportSourceLabel(latest.modelName)}` : "Weekly AI summary of what changed and why"}</CardDescription>
                {latest ? (
                  <CardAction>
                    <Button variant="ghost" size="sm" className={headerLink} render={<Link href="/insights" />}>
                      Open <ArrowRightIcon />
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                {latest ? (
                  <Link href="/insights" className="relative block max-h-56 overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <Markdown source={latest.contentMd} className="max-w-3xl" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                  </Link>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">No report yet. Works with a local model (Ollama), any API key, or without AI at all.</p>
                    <Button variant="outline" size="sm" className={headerLink} render={<Link href="/insights" />}>
                      <SparklesIcon /> Generate a report
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
            <Card className={cn("order-2 lg:col-span-2", waste.length && "ring-destructive/30")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangleIcon className={cn("size-4", waste.length ? "text-destructive" : "text-muted-foreground")} /> Wasted spend
                </CardTitle>
                <CardDescription>Campaigns with real spend and ROAS below 0.5x</CardDescription>
                {waste.length ? (
                  <CardAction>
                    <Badge variant="destructive" className="tabular h-6 px-2 text-xs font-semibold">
                      {moneyShort(wasteTotal, c)}
                    </Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="@container">
                {waste.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {cur.spendMinor === 0 ? "No ad spend in this period yet." : "Nothing obvious — every campaign with meaningful spend is returning revenue."}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {waste.slice(0, 4).map((w) => (
                    <li key={w.id}>
                      <Link href={campaignHref(w.id)} className={cn(rowLink, "flex min-h-11 items-center justify-between gap-3 py-1.5")}>
                        <span className="flex min-w-0 items-center gap-2">
                          <PlatformBadge platform={w.platform} compact="auto" />
                          <span className="truncate text-sm" title={w.name}>
                            {w.name}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end leading-tight">
                          <span className="tabular text-sm font-semibold text-destructive">{roas(w.roas)}</span>
                          <span className="tabular text-xs text-muted-foreground">{moneyShort(w.spendMinor, c)} spent</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {waste.length > 4 ? (
                  <Link href={perfHref()} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    +{waste.length - 4} more <ChevronRightIcon className="size-3.5" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>

            <Card className="order-4 lg:col-span-2">
              <CardHeader>
                <CardTitle>Revenue by channel</CardTitle>
                <CardDescription>Where credited revenue came from</CardDescription>
              </CardHeader>
              <CardContent className="@container">
                {ch.length === 0 ? <p className="text-sm text-muted-foreground">No conversions in this period.</p> : null}
                <ul className="grid gap-x-8 gap-y-4 @lg:grid-cols-2">
                  {ch.map((r) => {
                    const share = channelTotal > 0 ? Math.max(0, r.revenueMinor) / channelTotal : 0;
                    return (
                      <li key={r.channel} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{CHANNEL_LABELS[r.channel] ?? r.channel}</span>
                          <span className="tabular shrink-0">
                            <span className="font-medium">{moneyShort(r.revenueMinor, c)}</span>
                            <span className="text-muted-foreground"> · {pct(share, 0)}</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={r.channel === "unattributed" ? "h-full rounded-full bg-muted-foreground/40" : "h-full rounded-full bg-primary"}
                            style={{ width: `${Math.max(2, share * 100)}%` }}
                          />
                        </div>
                        <div className="tabular mt-1 text-xs text-muted-foreground">
                          {countLabel(r.leads, "lead")} · {countLabel(r.customers, "customer")}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <Card className="order-5">
              <CardHeader>
                <CardTitle>By ad platform</CardTitle>
                <CardDescription>Spend and the revenue each platform&apos;s ads earned</CardDescription>
              </CardHeader>
              <CardContent>
                {plats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Connect an ad platform to compare them here.</p>
                ) : (
                  <>
                    <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto_3.5rem] gap-x-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      <span>Platform</span>
                      <span className="text-right">Spend → revenue</span>
                      <span className="text-right">ROAS</span>
                    </div>
                    <ul className="space-y-0.5">
                      {plats.map((pl) => (
                        <li key={pl.platform}>
                          <Link
                            href={perfHref({ platform: pl.platform })}
                            className={cn(rowLink, "grid min-h-11 grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 py-1.5")}
                          >
                            <span className="min-w-0">
                              <PlatformBadge platform={pl.platform} className="text-sm font-medium text-foreground" />
                            </span>
                            <span className="tabular text-right text-xs text-muted-foreground">
                              {moneyShort(pl.spendMinor, c)} → <span className="text-foreground">{moneyShort(pl.revenueMinor, c)}</span>
                            </span>
                            <span className={cn("tabular text-right text-sm font-semibold", (pl.roas ?? 0) >= 1 ? "text-success" : "text-destructive")}>{roas(pl.roas)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
