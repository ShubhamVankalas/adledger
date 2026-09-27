import { CoinsIcon, GaugeIcon, PiggyBankIcon, SettingsIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/kpi-card";
import { PageBody, PageHeader } from "@/components/page-header";
import { LinkSegments } from "@/components/receipts/model-switch";
import { ProfitTable } from "@/components/profit/profit-table";
import { ProfitTabs, profitQuery } from "@/components/profit/profit-tabs";
import { ProfitWaterfall } from "@/components/profit/waterfall";
import { ReportControls } from "@/components/report-controls";
import { ReportEmpty } from "@/components/reports/report-ui";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, moneyKpi, pct, roas } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { getUnitEconomics, profitLedger, profitRows, type ProfitLevel } from "@/lib/reports-profit";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Profit" };

const LEVELS: { value: ProfitLevel; label: string }[] = [
  { value: "platform", label: "Platforms" },
  { value: "campaign", label: "Campaigns" },
  { value: "ad", label: "Ads" },
];

export default async function ProfitPage({ searchParams }: PageProps<"/profit">) {
  const denied = await gatePage("page.profit");
  if (denied) return denied;
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  const level = (LEVELS.some((l) => l.value === sp.level) ? sp.level : "campaign") as ProfitLevel;
  const ue = await getUnitEconomics(db, ws.id);
  const [ledger, rows] = await Promise.all([profitLedger(db, ws, p, ue), profitRows(db, ws, p, level, ue)]);
  const c = ws.reportingCurrency;
  const query = profitQuery(sp);
  const levelHref = (l: ProfitLevel) => {
    const q = new URLSearchParams(query.slice(1));
    if (l !== "campaign") q.set("level", l);
    const s = q.toString();
    return s ? `/profit?${s}` : "/profit";
  };
  const refundRate = ledger.grossSalesMinor > 0 ? Math.abs(ledger.refundsMinor) / ledger.grossSalesMinor : null;
  const shown = rows.filter((r) => r.spendMinor > 0 || r.revenueMinor !== 0);
  const empty = ledger.grossSalesMinor === 0 && ledger.spendMinor === 0;

  return (
    <>
      <PageHeader title="Profit" description="Profit per ad after refunds, fees and cost of goods">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showCompare={false} />
      </PageHeader>
      <PageBody>
        <ProfitTabs active="ledger" query={query} />

        {!ue.configured ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ui text-pretty">
              <span className="font-medium">Add your costs to see real profit.</span>{" "}
              <span className="text-muted-foreground">
                Until you set a cost of goods, payment fees and shipping, contribution equals revenue and POAS equals ROAS.
              </span>
            </p>
            {user.can("workspace.settings") ? (
              <Button variant="outline" size="sm" className="self-start sm:self-auto" render={<Link href="/settings/workspace/profit" />}>
                <SettingsIcon aria-hidden /> Set unit economics
              </Button>
            ) : (
              <p className="text-caption text-muted-foreground">Ask an owner or admin to set them.</p>
            )}
          </div>
        ) : null}

        {empty ? (
          <div className="rounded-xl bg-card shadow-(--elev-card)">
            <ReportEmpty icon={PiggyBankIcon} title="No sales or ad spend in this period">
              Connect a payment source and an ad account, or pick a longer date range.
            </ReportEmpty>
          </div>
        ) : (
          <>
            <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Net revenue" value={moneyKpi(ledger.netRevenueMinor, c)} icon={CoinsIcon} sub={refundRate !== null ? `${pct(refundRate)} refunded` : undefined} />
              <KpiCard
                label="Contribution"
                value={moneyKpi(ledger.contributionMinor, c)}
                icon={WalletIcon}
                sub={ledger.netRevenueMinor > 0 ? `${pct(ledger.contributionMinor / ledger.netRevenueMinor)} of revenue` : undefined}
                hint="Net revenue minus cost of goods, payment fees and shipping: what you keep from sales before paying for ads."
              />
              <KpiCard
                label="Profit after ads"
                value={moneyKpi(ledger.profitAfterAdsMinor, c)}
                icon={PiggyBankIcon}
                sub={`after ${moneyKpi(ledger.spendMinor, c)} ad spend`}
              />
              <KpiCard
                label="POAS"
                value={roas(ledger.poas)}
                icon={GaugeIcon}
                sub={`MER ${roas(ledger.mer)} · break-even ${roas(ledger.breakEvenRoas)}`}
                hint="Profit on ad spend: contribution ÷ ad spend. Above 1.00x your ads pay for themselves after every cost. MER is revenue ÷ spend; break-even is the MER you need to cover cost of goods."
              />
            </section>

            <section aria-labelledby="pnl-h" className="rounded-xl bg-card px-4 py-4 shadow-(--elev-card) sm:px-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="pnl-h" className="text-body font-semibold">
                  Profit and loss
                </h2>
                <p className="text-caption text-muted-foreground">
                  Every payment and refund in {c}, {dateRange(p.start, p.end, { year: true })}
                </p>
              </div>
              <ProfitWaterfall ledger={ledger} />
            </section>

            <section aria-labelledby="by-h" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
                <div>
                  <h2 id="by-h" className="text-body font-semibold">
                    Which ads make profit
                  </h2>
                  <p className="text-caption text-muted-foreground">Credited revenue, so totals leave out sales no ad touched.</p>
                </div>
                <LinkSegments label="Group by" value={level} options={LEVELS.map((l) => ({ ...l, href: levelHref(l.value) }))} />
              </div>
              {shown.length ? (
                <ProfitTable rows={shown} level={level} currency={c} workspaceRefundRate={refundRate} />
              ) : (
                <ReportEmpty icon={PiggyBankIcon} title="Nothing credited to ads in this period" className="border-t" />
              )}
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
