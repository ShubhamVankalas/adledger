import { eq } from "drizzle-orm";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { PerformanceTable } from "@/components/performance-table";
import { ReportControls } from "@/components/report-controls";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { resolvePeriodParams } from "@/lib/period";
import { performance, type PerfLevel } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Performance" };

const LEVELS: { key: PerfLevel; label: string; child: PerfLevel | null }[] = [
  { key: "campaign", label: "Campaigns", child: "ad_group" },
  { key: "ad_group", label: "Ad sets / ad groups", child: "ad" },
  { key: "ad", label: "Ads", child: null },
];

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const level = (LEVELS.find((l) => l.key === sp.level)?.key ?? "campaign") as PerfLevel;
  const parent = typeof sp.parent === "string" && /^[0-9a-f-]{36}$/i.test(sp.parent) ? sp.parent : undefined;
  const rows = await performance(db, ws, { ...p, level, parentId: parent });

  // Breadcrumb for drill-down.
  const crumbs: { label: string; href: string }[] = [];
  const keep = new URLSearchParams(
    Object.entries({ range: p.range, model: p.model, platform: p.platform ?? "", ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) }).filter(([, v]) => v),
  );
  const href = (extra: Record<string, string>) => `/performance?${new URLSearchParams({ ...Object.fromEntries(keep), ...extra })}`;
  if (parent && level === "ad_group") {
    const [c] = await db.select({ name: schema.campaigns.name }).from(schema.campaigns).where(eq(schema.campaigns.id, parent));
    crumbs.push({ label: c?.name ?? "Campaign", href: href({ level: "ad_group", parent }) });
  }
  if (parent && level === "ad") {
    const [g] = await db
      .select({ name: schema.adGroups.name, campaignId: schema.adGroups.campaignId, campaign: schema.campaigns.name })
      .from(schema.adGroups)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.adGroups.campaignId))
      .where(eq(schema.adGroups.id, parent));
    if (g) crumbs.push({ label: g.campaign, href: href({ level: "ad_group", parent: g.campaignId }) }, { label: g.name, href: href({ level: "ad", parent }) });
  }
  const current = LEVELS.find((l) => l.key === level)!;
  const childHref = current.child ? href({ level: current.child, parent: "__ID__" }) : null;

  return (
    <>
      <PageHeader title="Performance" description="Spend, leads, customers and revenue per campaign, ad set and ad">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} />
      </PageHeader>
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
            {LEVELS.map((l) => (
              <Link
                key={l.key}
                href={href({ level: l.key })}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  level === l.key && !parent && "bg-background text-foreground shadow-sm",
                  level === l.key && parent && "bg-background/60 text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          {crumbs.length ? (
            <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <Link href={href({ level: "campaign" })} className="hover:text-foreground">
                All campaigns
              </Link>
              {crumbs.map((c) => (
                <span key={c.href} className="flex min-w-0 items-center gap-1">
                  <ChevronRightIcon className="size-3.5 shrink-0" />
                  <Link href={c.href} className="truncate hover:text-foreground">
                    {c.label}
                  </Link>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <PerformanceTable
          rows={rows}
          currency={ws.reportingCurrency}
          childHref={childHref}
          levelLabel={current.label}
          filename={`adledger-${level}-${p.start}-${p.end}-${p.model}`}
        />
        <p className="text-xs text-muted-foreground">
          Leads, customers and revenue are credited with the <strong>{p.model.replace("_", "-")}</strong> model within a {ws.attributionWindowDays}-day window. Fractional values come from
          multi-touch credit. Spend is in {ws.reportingCurrency}; accounts in other currencies are excluded.
        </p>
      </PageBody>
    </>
  );
}
