import { FootprintsIcon, GitForkIcon, RouteIcon, UsersIcon } from "lucide-react";
import { Suspense } from "react";
import { FunnelChart } from "@/components/analysis/funnel";
import { PathsList } from "@/components/analysis/paths-list";
import { Answer, LinkSegmented, Num, Panel, PanelEmpty, stepLabel, withParams } from "@/components/analysis/primitives";
import { SectionTabs } from "@/components/analysis/section-tabs";
import { ATTRIBUTION_TABS, SectionTabsStatic } from "@/components/analysis/tabs";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, longDate, MODEL_LABELS, moneyShort, num, pct, platformLabel } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { attributionPaths, funnel, type PathConversion } from "@/lib/reports-analysis";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Journey paths" };

export default async function PathsPage({ searchParams }: PageProps<"/attribution/paths">) {
  const denied = await gatePage("page.attribution");
  if (denied) return denied;
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  // Journeys need a few weeks of conversions to show a pattern: default to the last 90 days.
  const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "90d" });
  const conversion: PathConversion = sp.conv === "lead" ? "lead" : "customer";
  const [r, f] = await Promise.all([attributionPaths(db, ws, p, { conversion, limit: 12 }), funnel(db, ws, p, { previous: p.comparison })]);
  const c = ws.reportingCurrency;
  const noun = conversion === "lead" ? "leads" : "customers";
  const top = r.rows.find((x) => x.steps.length > 0);
  const multi = r.singleTouchShare === null ? null : 1 - r.singleTouchShare;

  return (
    <>
      <PageHeader title="Attribution" description="The journeys people take before they buy">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showModel={Boolean(p.platform)} />
      </PageHeader>
      <PageBody>
        <Suspense fallback={<SectionTabsStatic tabs={ATTRIBUTION_TABS} active="/attribution/paths" label="Attribution views" />}>
          <SectionTabs tabs={ATTRIBUTION_TABS} label="Attribution views" />
        </Suspense>

        <Answer>
          {r.converters === 0 ? (
            <>No new {noun} between {dateRange(p.start, p.end)}. Try a longer date range.</>
          ) : top ? (
            <>
              {top.steps.length === 1 ? (
                <>
                  <Num>{pct(top.share, 0)}</Num> of new {noun} came straight from <Num>{stepLabel(top.steps[0])}</Num>, the most common journey.{" "}
                </>
              ) : (
                <>
                  The most common journey is <Num>{top.steps.map(stepLabel).join(" → ")}</Num>, taken by <Num>{pct(top.share, 0)}</Num> of new {noun}.{" "}
                </>
              )}
              {multi !== null ? (
                <>
                  <Num>{pct(multi, 0)}</Num> of tracked {noun} touched more than one channel first
                  {multi >= 0.3 ? ", so the model you pick changes who gets credit." : "."}
                </>
              ) : null}
            </>
          ) : (
            <>None of the {num(r.converters)} new {noun} had a tracked touch in the {r.windowDays}-day window. Install the pixel on every page to see their journeys.</>
          )}
        </Answer>

        <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label={conversion === "lead" ? "New leads" : "New customers"} value={num(r.converters)} icon={UsersIcon} sub={moneyShort(r.revenueMinor, c) + " revenue to date"} />
          <KpiCard
            label="Distinct journeys"
            value={num(r.distinctPaths)}
            icon={GitForkIcon}
            sub={r.converters ? `${pct(r.untrackedShare, 0)} untracked` : "—"}
            hint={`Different sequences of channels seen before converting, within the ${r.windowDays}-day attribution window. Repeats in a row count once (Meta, Meta, Google = Meta → Google).`}
          />
          <KpiCard
            label="Single touch"
            value={pct(r.singleTouchShare, 0)}
            icon={FootprintsIcon}
            sub="of tracked journeys"
            hint="Share of tracked converters with exactly one touch in the window. For them every attribution model gives the same answer."
          />
          <KpiCard label="Avg touches" value={r.avgTouches === null ? "—" : num(r.avgTouches, 1)} icon={RouteIcon} sub="before converting" hint="Average number of tracked touches (ad clicks and visits) in the attribution window, for converters with at least one." />
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-12">
          <Panel
            className="lg:col-span-8"
            id="paths"
            title="Top journeys"
            description={
              <>
                Channels and ad platforms each new {conversion === "lead" ? "lead" : "customer"} touched in the {r.windowDays} days before converting, in order
                {p.platform ? <>, that include {platformLabel(p.platform)}</> : null}.
              </>
            }
            action={
              <LinkSegmented
                label="Conversion"
                options={[
                  { href: withParams("/attribution/paths", sp, { conv: null }), label: "Customers", active: conversion === "customer" },
                  { href: withParams("/attribution/paths", sp, { conv: "lead" }), label: "Leads", active: conversion === "lead" },
                ]}
              />
            }
          >
            {r.rows.length === 0 ? (
              <PanelEmpty icon={RouteIcon} title={`No new ${noun} in this period`}>
                Journeys appear once people who visited through your pixel {conversion === "lead" ? "submit a form" : "pay"}.
              </PanelEmpty>
            ) : (
              <PathsList report={r} currency={c} noun={noun} />
            )}
          </Panel>

          <Panel
            className="lg:col-span-4"
            id="funnel"
            title="From visit to revenue"
            description={
              p.platform ? (
                <>
                  People touched by {platformLabel(p.platform)}, credited with the {MODEL_LABELS[p.model].toLowerCase()} model.
                </>
              ) : p.comparison ? (
                <>New leads and customers in the period. The line on each bar marks {p.compare === "year" ? "the same period last year" : "the previous period"}.</>
              ) : (
                <>New leads and customers in the period.</>
              )
            }
          >
            <FunnelChart report={f} currency={c} />
          </Panel>
        </div>

        <p className="max-w-3xl border-t pt-4 text-caption text-muted-foreground">
          A journey is every tracked touch (ad click, or a visit from search, social, email or a referral) in the {r.windowDays} days before someone&apos;s first{" "}
          {conversion === "lead" ? "form submission" : "payment"}: the same touches the attribution models share credit between. Revenue is each person&apos;s net payments to{" "}
          {longDate(p.end)} in {c}. Median time runs from the first touch to converting.
        </p>
      </PageBody>
    </>
  );
}
