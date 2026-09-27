import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { LogoMark } from "@/components/logo";
import { SpendRevenueCard } from "@/components/overview/spend-revenue-card";
import { DeltaText } from "@/components/overview/tone";
import { PlatformBadge } from "@/components/platform-badge";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, longDate, MODEL_LABELS, platformLabel } from "@/lib/format";
import { ipFromHeaders, rateLimit } from "@/lib/http";
import { formatMetric, metricDelta, METRICS, ratioX, type MetricKey } from "@/lib/metrics";
import { loadSharedReport, recordShareView, truncateIp, type SharedKpis } from "@/lib/share";


// Public, read-only view behind a share link: aggregates only (KPIs, spend vs revenue, top
// campaigns, platforms). Filters are locked in the link; URL parameters can't change them.
// Unknown, expired and revoked links all 404 the same way.

export const dynamic = "force-dynamic";

const load = cache(async (token: string, sp: Record<string, string | string[] | undefined>) => loadSharedReport(token, sp));

export async function generateMetadata({ params }: PageProps<"/share/[token]">): Promise<Metadata> {
  const { token } = await params;
  const data = await load(token, {});
  return {
    title: data ? `${data.link.label} · ${data.workspace.name}` : "Link not found",
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

const TILES: { key: MetricKey; field: keyof SharedKpis }[] = [
  { key: "revenue", field: "revenueMinor" },
  { key: "spend", field: "spendMinor" },
  { key: "roas", field: "roas" },
  { key: "leads", field: "leads" },
  { key: "customers", field: "customers" },
  { key: "cac", field: "cacMinor" },
];

export default async function SharedReportPage({ params, searchParams }: PageProps<"/share/[token]">) {
  const [{ token }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const ip = ipFromHeaders(h);
  if (!rateLimit(`share:${ip}`, 60)) {
    return (
      <Shell>
        <p className="py-24 text-center text-body text-muted-foreground">Too many requests from your network. Wait a minute and reload.</p>
      </Shell>
    );
  }
  const data = await load(token, sp);
  if (!data) notFound();

  after(async () => {
    const db = await getDb();
    await recordShareView(db, data.link.id);
    await audit({ id: null, organizationId: data.workspace.organizationId, workspaceId: data.workspace.id }, "share_link.view", data.link.id, { ip: truncateIp(ip) });
  });

  const cur = data.workspace.currency;
  const locked = data.period.platform;
  const expires = longDate(data.link.expiresAt.slice(0, 10));
  const periodText = dateRange(data.period.start, data.period.end, { year: true });
  const prevText = dateRange(data.previousPeriod.start, data.previousPeriod.end, { year: true });
  const label = (key: MetricKey) =>
    locked && key === "revenue" ? `Revenue from ${platformLabel(locked)}` : locked && (key === "leads" || key === "customers") ? `${METRICS[key].label} from ${platformLabel(locked)}` : METRICS[key].label;

  return (
    <Shell>
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-ui text-muted-foreground">{data.workspace.name}</p>
          <h1 className="text-title text-balance">{data.link.label}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
            <span className="num">{periodText}</span>
            <span aria-hidden className="text-fg-faint">
              /
            </span>
            <span>{MODEL_LABELS[data.period.model] ?? data.period.model} attribution</span>
            {locked ? (
              <>
                <span aria-hidden className="text-fg-faint">
                  /
                </span>
                <PlatformBadge platform={locked} className="text-foreground" />
              </>
            ) : null}
          </p>
        </div>
        <p className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md bg-fill px-2 py-1 text-caption text-muted-foreground">
          <LockIcon aria-hidden className="size-3.5" />
          Read-only, filters locked
        </p>
      </header>

      {data.ignoredParams.length ? (
        <p role="status" className="mt-4 rounded-lg bg-fill px-3 py-2 text-ui text-muted-foreground">
          This link always shows the view it was shared with. Changes in the address bar are ignored.
        </p>
      ) : null}

      <section aria-label="Key numbers" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TILES.map(({ key, field }) => {
          const value = data.current[field];
          const delta = metricDelta(value, data.previous[field], METRICS[key].polarity);
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1 rounded-lg bg-card px-4 pt-3.5 pb-3 shadow-(--elev-card)">
              <p className="truncate text-caption font-medium text-muted-foreground" title={METRICS[key].definition}>
                {label(key)}
              </p>
              <p className="num truncate text-kpi">{formatMetric(key, value, cur, { compact: true })}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
                <DeltaText delta={delta} />
                <span className="num truncate">was {formatMetric(key, data.previous[field], cur, { compact: true })}</span>
              </p>
            </div>
          );
        })}
      </section>

      <section aria-label="Spend and revenue by day" className="mt-4 h-[22rem] overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
        <SpendRevenueCard
          currency={cur}
          data={{
            days: data.series,
            spendMinor: data.current.spendMinor,
            attributedRevenueMinor: data.attributedRevenueMinor,
            prevAttributedRevenueMinor: data.prevAttributedRevenueMinor,
            roas: data.current.roas,
          }}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="campaigns-title" className="min-w-0 overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
          <div className="px-4 pt-3.5 pb-2 md:px-5">
            <h2 id="campaigns-title" className="text-sm leading-5 font-semibold">
              Top campaigns
            </h2>
            <p className="text-caption text-muted-foreground">By revenue credited to ads</p>
          </div>
          {data.campaigns.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-ui">
                <thead>
                  <tr className="border-y bg-bg-subtle text-left text-caption text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium md:px-5">
                      Campaign
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Spend
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Revenue
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      ROAS
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium md:px-5">
                      Customers
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.campaigns.map((c, i) => (
                    <tr key={`${c.name}-${i}`} className="h-11">
                      <td className="max-w-[18rem] px-4 md:px-5">
                        <span className="block truncate font-medium" title={c.name}>
                          {c.name}
                        </span>
                        <PlatformBadge platform={c.platform} className="text-caption" />
                      </td>
                      <td className="num px-3 text-right">{formatMetric("spend", c.spendMinor, cur)}</td>
                      <td className="num px-3 text-right">{formatMetric("revenue", c.revenueMinor, cur)}</td>
                      <td className="num px-3 text-right">{ratioX(c.roas)}</td>
                      <td className="num px-4 text-right md:px-5">{formatMetric("customers", c.customers, cur, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 pb-5 text-ui text-muted-foreground md:px-5">No campaign activity in this period.</p>
          )}
        </section>

        {locked ? null : (
          <section aria-labelledby="platforms-title" className="min-w-0 rounded-xl bg-card px-4 pt-3.5 pb-3 shadow-(--elev-card) md:px-5">
            <h2 id="platforms-title" className="text-sm leading-5 font-semibold">
              By platform
            </h2>
            <p className="text-caption text-muted-foreground">Spend and the revenue credited to it</p>
            {data.platforms.length ? (
              <ul className="mt-2 divide-y">
                {data.platforms.map((p) => (
                  <li key={p.platform} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                    <PlatformBadge platform={p.platform} className="text-ui text-foreground" />
                    <span className="text-right text-caption leading-4 text-muted-foreground">
                      <span className="num block text-ui font-medium text-foreground">{formatMetric("revenue", p.revenueMinor, cur, { compact: true })}</span>
                      <span className="num">
                        {formatMetric("spend", p.spendMinor, cur, { compact: true })} spend, {ratioX(p.roas)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-ui text-muted-foreground">No ad spend in this period.</p>
            )}
          </section>
        )}
      </div>

      <footer className="mt-10 flex flex-col gap-2 border-t pt-5 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty">
          Shared by <span className="font-medium text-foreground">{data.organizationName}</span>. This link expires {expires}. Changes are compared with {prevText}.
        </p>
        <a href="https://github.com/ShubhamVankalas/adledger" rel="noopener noreferrer" target="_blank" className="inline-flex w-fit items-center gap-1.5 rounded-sm hover:text-foreground">
          <LogoMark className="size-4 rounded-[4px]" />
          Figures computed by AdLedger
        </a>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="min-h-svh bg-background">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] md:px-8 md:pt-12">{children}</div>
    </main>
  );
}
