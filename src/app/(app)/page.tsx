import { desc, eq } from "drizzle-orm";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
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
import { Onboarding, getSetupStatus } from "@/components/onboarding";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { ReportControls } from "@/components/report-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { CHANNEL_LABELS, delta, money, moneyKpi, num, pct, roas } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { channels, overview, performance, platforms, previousPeriod, timeseries, wastedSpend } from "@/lib/reports";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { workspace: ws } = await requireUser();
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

  return (
    <>
      <PageHeader title="Overview" description="Which ads actually made you money">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} />
      </PageHeader>
      <PageBody>
        {!ws.isDemo && !setup.complete ? <Onboarding status={setup} /> : null}

        {cur.warnings.map((w) => (
          <div key={w} className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" /> {w}
          </div>
        ))}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Ad spend" value={moneyKpi(cur.spendMinor, c)} delta={delta(cur.spendMinor, prev.spendMinor)} goodWhenUp={null} icon={MegaphoneIcon} sub="vs prev. period" />
          <KpiCard label="Revenue" value={moneyKpi(cur.revenueMinor, c)} delta={delta(cur.revenueMinor, prev.revenueMinor)} icon={CoinsIcon} sub={`${money(cur.attributedRevenueMinor, c, true)} ads`} />
          <KpiCard
            accent
            label="ROAS"
            value={roas(cur.roas)}
            delta={delta(cur.roas, prev.roas)}
            icon={TrendingUpIcon}
            sub={`blended ${roas(cur.blendedRoas)}`}
            hint="Revenue attributed to ads ÷ ad spend, using the selected attribution model. Blended = all revenue ÷ ad spend."
          />
          <KpiCard label="Leads" value={num(cur.leads)} delta={delta(cur.leads, prev.leads)} icon={UserPlusIcon} sub={`CPL ${moneyKpi(cur.cplMinor, c)}`} />
          <KpiCard label="Customers" value={num(cur.customers)} delta={delta(cur.customers, prev.customers)} icon={HandCoinsIcon} sub={`CAC ${moneyKpi(cur.cacMinor, c)}`} />
          <KpiCard
            label="Unattributed"
            value={pct(cur.unattributedShare)}
            icon={TargetIcon}
            goodWhenUp={false}
            delta={delta(cur.unattributedShare, prev.unattributedShare)}
            sub={money(cur.unattributedRevenueMinor, c, true)}
            hint="Revenue from people with no tracked marketing touchpoint in the attribution window. Lower is better — install the pixel everywhere and pass the visitor ID to checkout."
          />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 2xl:grid-cols-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Spend vs revenue</CardTitle>
              <CardDescription>Daily ad spend against revenue attributed to ads ({p.model.replace("_", "-")} model)</CardDescription>
            </CardHeader>
            <CardContent className="px-2 sm:px-4">
              {empty ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">No data in this period yet.</div>
              ) : (
                <SpendRevenueChart data={series} currency={c} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue by channel</CardTitle>
              <CardDescription>Where credited revenue came from</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {ch.length === 0 ? <p className="text-sm text-muted-foreground">No conversions in this period.</p> : null}
              {ch.map((r) => {
                const share = channelTotal > 0 ? Math.max(0, r.revenueMinor) / channelTotal : 0;
                return (
                  <div key={r.channel} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{CHANNEL_LABELS[r.channel] ?? r.channel}</span>
                      <span className="tabular text-muted-foreground">
                        {money(r.revenueMinor, c, true)} · {pct(share, 0)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={r.channel === "unattributed" ? "h-full rounded-full bg-muted-foreground/40" : "h-full rounded-full bg-primary"}
                        style={{ width: `${Math.max(2, share * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground tabular">
                      {num(r.leads, 1)} leads · {num(r.customers, 1)} customers
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 2xl:col-span-1">
            <CardHeader>
              <CardTitle>By ad platform</CardTitle>
              <CardDescription>Spend and the revenue each platform&apos;s ads earned</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {plats.length === 0 ? <p className="text-sm text-muted-foreground">Connect an ad platform to compare them here.</p> : null}
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
                {plats.map((pl) => (
                  <Link
                    key={pl.platform}
                    href={`/performance?platform=${pl.platform}&range=${p.range}&model=${p.model}${p.range === "custom" ? `&from=${p.start}&to=${p.end}` : ""}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <PlatformBadge platform={pl.platform} />
                      <span className="tabular truncate text-xs text-muted-foreground">
                        {money(pl.spendMinor, c, true)} → {money(pl.revenueMinor, c, true)}
                      </span>
                    </span>
                    <span className={(pl.roas ?? 0) >= 1 ? "tabular text-sm font-semibold text-success" : "tabular text-sm font-semibold text-destructive"}>{roas(pl.roas)}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Top campaigns by revenue</CardTitle>
              <CardDescription>Revenue credited to each campaign and its return on ad spend</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" render={<Link href={`/performance?${new URLSearchParams({ range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) })}`} />}>
                  All campaigns <ArrowRightIcon />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-1">
              {top.length === 0 ? <p className="text-sm text-muted-foreground">Connect Meta or Google Ads to see campaigns here.</p> : null}
              {top.map((t) => (
                <Link
                  key={t.id}
                  href={`/performance?level=ad_group&parent=${t.id}&range=${p.range}&model=${p.model}${p.range === "custom" ? `&from=${p.start}&to=${p.end}` : ""}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={t.platform} />
                    <span className="truncate text-sm font-medium">{t.name}</span>
                  </div>
                  <span className="tabular text-right text-sm font-semibold">{money(t.revenueMinor, c, true)}</span>
                  <span className="tabular hidden text-right text-xs text-muted-foreground sm:block">spend {money(t.spendMinor, c, true)}</span>
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={(t.roas ?? 0) >= 1 ? "h-full rounded-full bg-success" : "h-full rounded-full bg-destructive/70"}
                        style={{ width: `${Math.min(100, ((t.roas ?? 0) / maxRoas) * 100)}%` }}
                      />
                    </div>
                    <span className="tabular w-12 text-right text-xs font-medium">{roas(t.roas)}</span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className={waste.length ? "border-destructive/30" : undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangleIcon className="size-4 text-destructive" /> Wasted spend
                </CardTitle>
                <CardDescription>Campaigns with real spend and ROAS below 0.5x</CardDescription>
                {waste.length ? (
                  <CardAction>
                    <Badge variant="destructive" className="tabular">
                      {money(wasteTotal, c, true)}
                    </Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-2">
                {waste.length === 0 ? <p className="text-sm text-muted-foreground">Nothing obvious — every campaign with meaningful spend is returning revenue.</p> : null}
                {waste.slice(0, 4).map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <PlatformBadge platform={w.platform} />
                      <span className="truncate">{w.name}</span>
                    </span>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {money(w.spendMinor, c, true)} → <span className="font-medium text-foreground">{roas(w.roas)}</span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-primary/25 bg-gradient-to-br from-primary/[0.07] to-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SparklesIcon className="size-4 text-primary" /> Latest insight
                </CardTitle>
                <CardDescription>{latest ? `${latest.periodStart} → ${latest.periodEnd} · ${latest.modelName}` : "Weekly AI summary of what changed and why"}</CardDescription>
                <CardAction>
                  <Button variant="ghost" size="sm" render={<Link href="/insights" />}>
                    Open <ArrowRightIcon />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {latest ? (
                  <div className="relative max-h-48 overflow-hidden">
                    <Markdown source={latest.contentMd} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No report yet. Generate one on the Insights page — works with a local model (Ollama) or any API key, or without AI at all.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
