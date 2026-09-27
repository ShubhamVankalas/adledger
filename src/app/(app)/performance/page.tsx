import { eq } from "drizzle-orm";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { NoAdDataYet, getSetupStatus } from "@/components/onboarding";
import { PageBody, PageHeader } from "@/components/page-header";
import type { PerfTargets } from "@/components/performance/columns";
import { PerformanceView, type LevelInfo } from "@/components/performance/performance-view";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { MODEL_LABELS } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { getTargets, targetFor } from "@/lib/reports-goals";
import type { PerfLevel } from "@/lib/reports";
import { performanceReport } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";
import { listViews } from "@/lib/views";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Performance" };

const LEVELS: LevelInfo[] = [
  { key: "campaign", label: "Campaigns", short: "Campaigns", child: "ad_group" },
  { key: "ad_group", label: "Ad sets", short: "Ad sets", child: "ad" },
  { key: "ad", label: "Ads", short: "Ads", child: null },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const denied = await gatePage("page.performance");
  if (denied) return denied;
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const level = (LEVELS.find((l) => l.key === one(sp.level))?.key ?? "campaign") as PerfLevel;
  const rawParent = one(sp.parent);
  const parent = rawParent && UUID.test(rawParent) && level !== "campaign" ? rawParent : undefined;
  const q = (one(sp.q) ?? "").trim().slice(0, 200);

  // Workspace targets (Settings → Targets & goals) colour the stoplights and set the quadrant's ROAS
  // bar. With none set, the table shows no dots and splits the quadrant at break-even.
  const goals = await getTargets(db, ws);
  const targets: PerfTargets = Object.fromEntries(
    (
      [
        ["roas", targetFor(goals, "roas")],
        ["cacMinor", targetFor(goals, "cac")],
        ["cplMinor", targetFor(goals, "cpl")],
      ] as const
    ).filter(([, v]) => v !== null),
  );

  const [report, views, crumbs] = await Promise.all([
    performanceReport(db, ws, { ...p, level, parentId: parent, q: q || undefined, comparison: p.comparison, roasSplit: targets.roas }),
    listViews(db, ws.id, user.id, "performance"),
    breadcrumbs(db, ws.id, level, parent),
  ]);

  // No ad platform connected and no spend imported yet: explain how to get data instead of an empty table.
  if (report.rows.length === 0 && !parent && !q && !ws.isDemo && !(await getSetupStatus(db, ws)).steps.some((s) => s.key === "ads" && s.done)) {
    return (
      <>
        <PageHeader title="Performance" description="Spend, leads, customers and revenue per campaign, ad set and ad" />
        <PageBody>
          <NoAdDataYet canSetup={user.can("workspace.settings")} />
        </PageBody>
      </>
    );
  }

  // Breadcrumb links keep the report's filters and display settings, and drop per-screen state.
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = one(v);
    if (s && !["level", "parent", "peek", "q", "view"].includes(k)) keep.set(k, s);
  }
  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...Object.fromEntries(keep), ...extra }).toString();
    return qs ? `/performance?${qs}` : "/performance";
  };

  return (
    <>
      <PageHeader title="Performance" description="Spend, leads, customers and revenue per campaign, ad set and ad">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} compare={p.compare} />
      </PageHeader>
      <PageBody>
        {crumbs.length ? (
          <nav aria-label="Breadcrumb" className="-mb-1 flex min-w-0 flex-wrap items-center gap-x-1 text-ui text-muted-foreground">
            <Link href={href({})} className="inline-flex min-h-10 items-center rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-0">
              All campaigns
            </Link>
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex min-w-0 items-center gap-1">
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
                <Link
                  href={href({ level: c.level, parent: c.id })}
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 max-w-[70vw] min-w-0 items-center truncate rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-0 md:max-w-80",
                    i === crumbs.length - 1 && "font-medium text-foreground",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
        <PerformanceView
          report={report}
          levels={LEVELS}
          level={level}
          parent={parent ?? null}
          currency={ws.reportingCurrency}
          period={{ start: p.start, end: p.end, model: p.model, comparison: p.comparison }}
          filename={`adledger-${level}-${p.start}-${p.end}-${p.model}`}
          views={views}
          canShareViews={user.can("views.share")}
          targets={targets}
          serverQ={q}
        />
        <footer className="flex flex-col gap-3 border-t pt-4 text-caption text-muted-foreground lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl text-pretty">
            Leads, customers and revenue are credited with the <strong className="font-medium text-foreground">{MODEL_LABELS[p.model].toLowerCase()}</strong> model within a{" "}
            {ws.attributionWindowDays}-day window.
            {p.model === "linear" ? " Linear credit splits each person across the ads they touched, so small counts can show a decimal; hover a count for the exact value." : null} Platform
            conversions are what each ad platform reports with its own attribution; verified conversions are the leads and new customers AdLedger matched to real people.
            Amounts are in {ws.reportingCurrency}; ad accounts in other currencies are excluded.
          </p>
          <nav aria-label="Related reports" className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/attribution"
              className="inline-flex h-10 items-center gap-1 rounded-md border bg-surface px-3 text-ui font-medium text-foreground outline-none transition-colors duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring md:h-8"
            >
              Compare models <ChevronRightIcon aria-hidden className="size-3.5" />
            </Link>
            <Link
              href="/customers"
              className="inline-flex h-10 items-center gap-1 rounded-md border bg-surface px-3 text-ui font-medium text-foreground outline-none transition-colors duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring md:h-8"
            >
              Customer LTV <ChevronRightIcon aria-hidden className="size-3.5" />
            </Link>
          </nav>
        </footer>
      </PageBody>
    </>
  );
}

/** "All campaigns › Campaign › Ad set" for the drilled-in levels (workspace scoped). */
async function breadcrumbs(db: Awaited<ReturnType<typeof getDb>>, workspaceId: string, level: PerfLevel, parent: string | undefined) {
  const out: { id: string; label: string; level: PerfLevel }[] = [];
  if (!parent) return out;
  if (level === "ad_group") {
    const [c] = await db.select({ name: schema.campaigns.name, ws: schema.campaigns.workspaceId }).from(schema.campaigns).where(eq(schema.campaigns.id, parent));
    if (c && c.ws === workspaceId) out.push({ id: parent, label: c.name, level: "ad_group" });
  }
  if (level === "ad") {
    const [g] = await db
      .select({ name: schema.adGroups.name, ws: schema.adGroups.workspaceId, campaignId: schema.adGroups.campaignId, campaign: schema.campaigns.name })
      .from(schema.adGroups)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.adGroups.campaignId))
      .where(eq(schema.adGroups.id, parent));
    if (g && g.ws === workspaceId) out.push({ id: g.campaignId, label: g.campaign, level: "ad_group" }, { id: parent, label: g.name, level: "ad" });
  }
  return out;
}
