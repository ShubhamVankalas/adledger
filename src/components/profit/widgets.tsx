import { PiggyBankIcon, ScaleIcon } from "lucide-react";
import { CardLink, WidgetCard, WidgetEmpty } from "@/components/overview/widget-card";
import { PlatformBadge } from "@/components/platform-badge";
import { getViewer, type DashParams } from "@/lib/dashboard/data";
import { getDb } from "@/lib/db";
import { moneyShort, platformLabel, roas } from "@/lib/format";
import { profitLedger } from "@/lib/reports-profit";
import { biggestGap, truthGap } from "@/lib/reports-trust";
import { cn } from "@/lib/utils";
import { ClaimRatio } from "./truth-parts";

// Overview widgets for the money-truth reports (wired into src/lib/widgets/** by the integrator).
// Async server components: each streams inside the board's own Suspense + error boundary.

const query = (p: DashParams) =>
  new URLSearchParams({ range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}), ...(p.platform ? { platform: p.platform } : {}) }).toString();

/** "Meta says $X, your payments show $Y": the biggest platform over-claim, plus one line per platform. */
export async function TruthGapWidget({ p, currency }: { p: DashParams; currency: string }) {
  const [db, { workspace }] = await Promise.all([getDb(), getViewer()]);
  const gap = await truthGap(db, workspace, p);
  const rows = gap.platforms.filter((r) => r.platformValueMinor !== null && r.spendMinor > 0).slice(0, 4);
  const top = biggestGap(rows);
  return (
    <WidgetCard title="Truth gap" description="What platforms claim vs payments you received" action={<CardLink href={`/truth?${query(p)}`}>Details</CardLink>}>
      {rows.length === 0 ? (
        <WidgetEmpty icon={ScaleIcon} title="No platform reports sales value yet">
          Meta, Google and TikTok report a purchase value once they sync.
        </WidgetEmpty>
      ) : (
        <div className="space-y-3">
          {top ? (
            <p className="text-ui text-pretty">
              {platformLabel(top.platform)} claims <span className="num font-semibold">{moneyShort(top.platformValueMinor, currency)}</span>; payments from its
              clickers: <span className="num font-semibold">{moneyShort(top.verifiedRevenueMinor, currency)}</span>.
            </p>
          ) : null}
          <ul className="divide-y divide-border/70">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <PlatformBadge platform={r.platform} className="text-ui text-foreground" />
                <span className="flex items-center gap-2">
                  <span className="num text-caption text-muted-foreground">
                    {moneyShort(r.platformValueMinor, currency)} vs {moneyShort(r.verifiedRevenueMinor, currency)}
                  </span>
                  <ClaimRatio ratio={r.valueRatio} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Profit after ads with POAS and the three cost lines, linking to the Profit page. */
export async function ProfitWidget({ p, currency }: { p: DashParams; currency: string }) {
  const [db, { workspace }] = await Promise.all([getDb(), getViewer()]);
  const l = await profitLedger(db, workspace, p);
  const lines: [string, number][] = [
    ["Net revenue", l.netRevenueMinor],
    ["Costs of sales", -(l.cogsMinor + l.feesMinor + l.shippingMinor)],
    ["Ad spend", -l.spendMinor],
  ];
  return (
    <WidgetCard
      title="Profit after ads"
      description={l.unitEconomics.configured ? `POAS ${roas(l.poas)} · break-even ROAS ${roas(l.breakEvenRoas)}` : "Set unit economics for real profit"}
      action={<CardLink href={`/profit?${query(p)}`}>Ledger</CardLink>}
    >
      {l.netRevenueMinor === 0 && l.spendMinor === 0 ? (
        <WidgetEmpty icon={PiggyBankIcon} title="No sales or spend in this period" />
      ) : (
        <div className="space-y-3">
          <p className={cn("num text-kpi", l.profitAfterAdsMinor < 0 ? "text-negative" : "text-positive")}>{moneyShort(l.profitAfterAdsMinor, currency)}</p>
          <dl className="space-y-1 text-ui">
            {lines.map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="num">{v < 0 ? `−${moneyShort(-v, currency)}` : moneyShort(v, currency)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </WidgetCard>
  );
}
