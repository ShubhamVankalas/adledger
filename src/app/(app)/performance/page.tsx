import { eq } from "drizzle-orm";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { NoAdDataYet, getSetupStatus } from "@/components/onboarding";
import { PageBody, PageHeader } from "@/components/page-header";
import { PerformanceTable } from "@/components/performance-table";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { resolvePeriodParams } from "@/lib/period";
import { performance, type PerfLevel } from "@/lib/reports";
import { MODEL_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Performance" };

const LEVELS: {
  key: PerfLevel;
  label: string;
  short: string;
  child: PerfLevel | null;
}[] = [
  {
    key: "campaign",
    label: "Campaigns",
    short: "Campaigns",
    child: "ad_group",
  },
  {
    key: "ad_group",
    label: "Ad sets / ad groups",
    short: "Ad sets",
    child: "ad",
  },
  { key: "ad", label: "Ads", short: "Ads", child: null },
];

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const level = (LEVELS.find((l) => l.key === sp.level)?.key ??
    "campaign") as PerfLevel;
  const parent =
    typeof sp.parent === "string" && /^[0-9a-f-]{36}$/i.test(sp.parent)
      ? sp.parent
      : undefined;
  const rows = await performance(db, ws, { ...p, level, parentId: parent });

  // No ad platform connected and no spend imported yet: explain how to get data instead of an empty table.
  if (rows.length === 0 && !parent && !ws.isDemo && !(await getSetupStatus(db, ws)).steps.some((s) => s.key === "ads" && s.done)) {
    return (
      <>
        <PageHeader title="Performance" description="Spend, leads, customers and revenue per campaign, ad set and ad" />
        <PageBody>
          <NoAdDataYet canSetup={user.can("workspace.settings")} />
        </PageBody>
      </>
    );
  }

  // Breadcrumb for drill-down.
  const crumbs: { label: string; href: string }[] = [];
  const keep = new URLSearchParams(
    Object.entries({
      range: p.range,
      model: p.model,
      platform: p.platform ?? "",
      ...(p.range === "custom" ? { from: p.start, to: p.end } : {}),
    }).filter(([, v]) => v),
  );
  const href = (extra: Record<string, string>) =>
    `/performance?${new URLSearchParams({ ...Object.fromEntries(keep), ...extra })}`;
  if (parent && level === "ad_group") {
    const [c] = await db
      .select({ name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, parent));
    crumbs.push({
      label: c?.name ?? "Campaign",
      href: href({ level: "ad_group", parent }),
    });
  }
  if (parent && level === "ad") {
    const [g] = await db
      .select({
        name: schema.adGroups.name,
        campaignId: schema.adGroups.campaignId,
        campaign: schema.campaigns.name,
      })
      .from(schema.adGroups)
      .innerJoin(
        schema.campaigns,
        eq(schema.campaigns.id, schema.adGroups.campaignId),
      )
      .where(eq(schema.adGroups.id, parent));
    if (g)
      crumbs.push(
        {
          label: g.campaign,
          href: href({ level: "ad_group", parent: g.campaignId }),
        },
        { label: g.name, href: href({ level: "ad", parent }) },
      );
  }
  const current = LEVELS.find((l) => l.key === level)!;
  const childHref = current.child
    ? href({ level: current.child, parent: "__ID__" })
    : null;

  const levelNav = (
    <nav
      aria-label="Report level"
      className="grid grid-cols-3 gap-0.5 rounded-lg border bg-muted/40 p-0.5 @3xl:flex @3xl:shrink-0"
    >
      {LEVELS.map((l) => {
        const active = level === l.key;
        return (
          <Link
            key={l.key}
            href={href({ level: l.key })}
            aria-current={active && !parent ? "page" : undefined}
            className={cn(
              "flex h-10 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 @3xl:h-8",
              active &&
                "bg-background text-foreground shadow-sm dark:bg-input/40",
            )}
          >
            <span className="@3xl:hidden">{l.short}</span>
            <span className="hidden @3xl:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <PageHeader
        title="Performance"
        description="Spend, leads, customers and revenue per campaign, ad set and ad"
      >
        <ReportControls
          start={p.start}
          end={p.end}
          range={p.range}
          model={p.model}
          platform={p.platform}
        />
      </PageHeader>
      <PageBody>
        {crumbs.length ? (
          <nav
            aria-label="Breadcrumb"
            className="-mb-2 flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted-foreground"
          >
            <Link
              href={href({ level: "campaign" })}
              className="inline-flex min-h-10 items-center rounded-sm outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-0"
            >
              All campaigns
            </Link>
            {crumbs.map((c, i) => (
              <span key={c.href} className="flex min-w-0 items-center gap-1">
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
                <Link
                  href={c.href}
                  aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 max-w-[70vw] min-w-0 items-center truncate rounded-sm outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-0 md:max-w-80",
                    i === crumbs.length - 1 && "font-medium text-foreground",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
        <PerformanceTable
          rows={rows}
          currency={ws.reportingCurrency}
          childHref={childHref}
          levelLabel={current.label}
          filename={`adledger-${level}-${p.start}-${p.end}-${p.model}`}
          nav={levelNav}
        />
        <div className="flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-3xl">
            Leads, customers and revenue are credited with the{" "}
            <strong className="text-foreground">
              {MODEL_LABELS[p.model].toLowerCase()}
            </strong>{" "}
            model within a {ws.attributionWindowDays}-day window.
            {p.model === "linear"
              ? " Linear credit splits each person across the ads they touched, so small counts can show a decimal; hover a count for the exact value."
              : null}{" "}
            Amounts are in {ws.reportingCurrency}; ad accounts in other
            currencies are excluded.
          </p>
          <nav
            aria-label="Related reports"
            className="flex shrink-0 flex-wrap gap-2"
          >
            <Link
              href="/reports/models"
              className="inline-flex h-10 items-center gap-1 rounded-lg border bg-card px-3 font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9"
            >
              Compare models{" "}
              <ChevronRightIcon aria-hidden className="size-3.5" />
            </Link>
            <Link
              href="/reports/ltv"
              className="inline-flex h-10 items-center gap-1 rounded-lg border bg-card px-3 font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9"
            >
              Customer LTV <ChevronRightIcon aria-hidden className="size-3.5" />
            </Link>
          </nav>
        </div>
      </PageBody>
    </>
  );
}
