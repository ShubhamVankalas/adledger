import { CircleCheckIcon, LayersIcon, SparklesIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { tintStyle, TINT } from "@/lib/avatar-tint";
import { loadCampaigns, loadLatestInsight, loadRecent, loadScorecard, loadWasted, type DashParams } from "@/lib/dashboard/data";
import { insightBullets, type InsightBullet } from "@/lib/dashboard/insight";
import { channelLabel, dateRange, MODEL_LABELS, moneyShort, moneyWhole, pct, platformLabel, reportSourceLabel } from "@/lib/format";
import { metricDelta, ratioX } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { WidgetSettings } from "@/lib/widgets/catalog";
import { NEGATIVE_TEXT, POSITIVE_TEXT, DeltaText } from "../tone";
import { TopCampaignsCard, type CampaignRow } from "../top-campaigns-list";
import { CardLink, LIST_ROW, WidgetCard, WidgetEmpty } from "../widget-card";

const periodQuery = (p: DashParams, extra: Record<string, string> = {}) =>
  new URLSearchParams({ ...extra, range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) }).toString();
const campaignHref = (p: DashParams, id: string) => `/performance?${periodQuery(p, { level: "ad_group", parent: id })}`;

// ---------------------------------------------------------------- top campaigns

export async function TopCampaignsWidget({ p, currency, settings }: { p: DashParams; currency: string; settings?: WidgetSettings }) {
  const rows = await loadCampaigns(p.start, p.end, p.model, p.platform);
  const slim: CampaignRow[] = rows.map((r) => ({ id: r.id, name: r.name, platform: r.platform, spendMinor: r.spendMinor, revenueMinor: r.revenueMinor, roas: r.roas, href: campaignHref(p, r.id) }));
  return (
    <TopCampaignsCard
      rows={slim}
      currency={currency}
      initialSort={settings?.sort}
      topN={settings?.topN ?? 6}
      allHref={`/performance?${periodQuery(p)}`}
      modelLabel={`${MODEL_LABELS[p.model] ?? p.model} model`}
    />
  );
}

// ---------------------------------------------------------------- wasted spend

export async function WastedSpendWidget({ p, currency }: { p: DashParams; currency: string }) {
  const { rows, medianDays, totalMinor } = await loadWasted(p.start, p.end, p.model, p.platform);
  const shown = rows.slice(0, 5);
  return (
    <WidgetCard
      title="Wasted spend"
      description={medianDays ? `ROAS under 0.5× · customers take ${Math.round(medianDays)} days to buy` : "Real spend with ROAS under 0.5×"}
      action={
        totalMinor > 0 ? (
          <span className={cn("inline-flex h-6 items-center rounded-full bg-[color:var(--negative,var(--destructive))]/10 px-2 text-xs font-medium tabular-nums", NEGATIVE_TEXT)}>
            {moneyShort(totalMinor, currency)} at risk
          </span>
        ) : null
      }
      bodyClassName="pt-1.5"
    >
      {shown.length === 0 ? (
        <WidgetEmpty icon={CircleCheckIcon} title="Nothing obvious">
          Every campaign with meaningful spend is bringing in revenue.
        </WidgetEmpty>
      ) : (
        <ul className="flex flex-col">
          {shown.map((r) => (
            <li key={r.id} className="border-b border-border/70 last:border-0">
              <Link href={campaignHref(p, r.id)} className={LIST_ROW}>
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformBadge platform={r.platform} compact />
                  <span className="truncate text-[13px] font-medium" title={r.name}>
                    {r.name}
                  </span>
                  {r.tooEarly ? (
                    <span
                      className="shrink-0 rounded-full bg-[color:var(--warning)]/15 px-1.5 text-[11px] leading-[18px] font-medium text-[color:oklch(0.5_0.12_65)] dark:text-[color:var(--warning)]"
                      title={
                        r.judgeAfterDays
                          ? `Running ${r.ageDays ?? 0} day${r.ageDays === 1 ? "" : "s"}; 80% of buyers take ${r.judgeAfterDays} day${r.judgeAfterDays === 1 ? "" : "s"} to pay. Judge it from ${r.judgeFrom ?? "later"}.`
                          : `Running ${r.ageDays ?? 0} day${r.ageDays === 1 ? "" : "s"}; customers usually take ${Math.round(medianDays ?? 0)} days to buy.`
                      }
                    >
                      Too early
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col items-end leading-tight">
                  <span className={cn("text-[13px] font-semibold tabular-nums", r.tooEarly ? "text-muted-foreground" : NEGATIVE_TEXT)}>{ratioX(r.roas)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{moneyShort(r.spendMinor, currency)} spent</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------- platform scorecard

export async function PlatformsWidget({ p, currency }: { p: DashParams; currency: string }) {
  const rows = await loadScorecard(p.start, p.end, p.model);
  return (
    <WidgetCard title="Platform scorecard" description="Spend, revenue credited to ads and share of spend" bodyClassName="pt-1.5">
      {rows.length === 0 ? (
        <WidgetEmpty icon={LayersIcon} title="No ad platforms yet" action={<CardLink href="/settings/workspace/integrations">Connect ads</CardLink>}>
          Connect Meta, Google Ads or another platform to compare them here.
        </WidgetEmpty>
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, 6).map((r) => {
            const delta = metricDelta(r.roas, r.prevRoas, "up");
            return (
              <li key={r.platform} className="border-b border-border/70 last:border-0">
                <Link href={`/performance?${periodQuery(p, { platform: r.platform })}`} className={LIST_ROW}>
                  <span className="flex min-w-0 items-center gap-2">
                    <PlatformBadge platform={r.platform} className="text-[13px] font-medium text-foreground" />
                    <span className="text-xs text-muted-foreground tabular-nums" title="Share of ad spend">
                      {pct(r.spendShare, 0)}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:block">
                      {moneyShort(r.spendMinor, currency)} → <span className="text-foreground">{moneyShort(r.revenueMinor, currency)}</span>
                    </span>
                    <span className="flex w-16 flex-col items-end leading-tight">
                      <span className={cn("text-[13px] font-semibold tabular-nums", r.roas !== null && (r.roas >= 1 ? POSITIVE_TEXT : NEGATIVE_TEXT))}>{ratioX(r.roas)}</span>
                      <DeltaText delta={delta} className="text-[11px]" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------- recent leads & customers

const initials = (s: string) =>
  s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function RecentWidget({ p }: { p: DashParams }) {
  const rows = await loadRecent(p.end);
  // eslint-disable-next-line react-hooks/purity -- server component: rendered once per request
  const now = Date.now();
  return (
    <WidgetCard title="Recent leads & customers" description="Newest first, with the ad that first brought them in" action={<CardLink href="/contacts">All</CardLink>} bodyClassName="pt-1.5">
      {rows.length === 0 ? (
        <WidgetEmpty icon={UsersIcon} title="No leads or payments yet">
          New leads and customers show up here as they arrive.
        </WidgetEmpty>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const display = r.name ?? r.maskedEmail ?? "Unknown contact";
            const source = r.campaign ? r.campaign : r.channel ? channelLabel(r.channel) : "No tracked source";
            return (
              <li key={`${r.kind}-${r.id}`} className="border-b border-border/70 last:border-0">
                <Link href={`/contacts/${r.contactId}`} className={LIST_ROW}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden style={tintStyle(r.contactId)} className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold", TINT)}>
                      {initials(display)}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13px] font-medium">
                        {display}
                        {r.name && r.maskedEmail ? <span className="ml-1.5 font-normal text-muted-foreground max-sm:hidden">{r.maskedEmail}</span> : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        {r.platform ? <PlatformBadge platform={r.platform} compact /> : null}
                        <span className="truncate" title={r.platform ? `${platformLabel(r.platform)} · ${source}` : source}>
                          {source}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end leading-tight">
                    {r.kind === "payment" && r.amountMinor !== null && r.currency ? (
                      <span className={cn("text-[13px] font-semibold tabular-nums", POSITIVE_TEXT)}>{moneyWhole(r.amountMinor, r.currency)}</span>
                    ) : (
                      <span className="rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground">New lead</span>
                    )}
                    <span className="text-xs text-muted-foreground">{ago(r.at, now)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------- AI insight

type Bullet = InsightBullet;

/** **bold** spans become number chips; everything else is plain text (React escapes it). */
function Inline({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <strong key={i} className="font-medium text-foreground">
            {part}
          </strong>
        ) : (
          <span key={i}>{part.replace(/\*/g, "")}</span>
        ),
      )}
    </>
  );
}

const MARK: Record<Bullet["tone"], { glyph: string; className: string; label: string }> = {
  good: { glyph: "▲", className: POSITIVE_TEXT, label: "Working" },
  bad: { glyph: "▼", className: NEGATIVE_TEXT, label: "Wasted" },
  action: { glyph: "→", className: "text-muted-foreground", label: "Next step" },
};

export async function InsightWidget() {
  const latest = await loadLatestInsight();
  const bullets = latest ? insightBullets(latest.contentMd) : [];
  return (
    <WidgetCard
      title={
        <span className="flex items-center gap-1.5">
          <SparklesIcon aria-hidden className="size-3.5 text-[color:var(--chart-revenue,var(--chart-1))]" strokeWidth={1.75} />
          This week in one read
        </span>
      }
      description={latest ? `${dateRange(latest.periodStart, latest.periodEnd)} · ${reportSourceLabel(latest.modelName)}${latest.unverified.length === 0 ? " · numbers verified" : ""}` : "A weekly summary of what changed and why"}
      action={latest ? <CardLink href="/insights">Open report</CardLink> : null}
    >
      {bullets.length === 0 ? (
        <WidgetEmpty icon={SparklesIcon} title="No report yet" action={<CardLink href="/insights">Generate a report</CardLink>}>
          Works with a local model, any API key, or without AI at all.
        </WidgetEmpty>
      ) : (
        <ul className="flex flex-col gap-3.5 text-[13px] leading-5">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className={cn("mt-px w-3 shrink-0 text-center text-[11px] leading-5", MARK[b.tone].className)}>
                {MARK[b.tone].glyph}
              </span>
              <span className="line-clamp-3 text-pretty text-muted-foreground">
                <span className="sr-only">{MARK[b.tone].label}: </span>
                <Inline text={b.text} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
