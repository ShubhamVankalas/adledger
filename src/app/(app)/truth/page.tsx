import { ScaleIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformTruth, TruthCampaignTable, TruthHeadline } from "@/components/profit/truth-parts";
import { ReportControls } from "@/components/report-controls";
import { ReportEmpty } from "@/components/reports/report-ui";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange, MODEL_LABELS } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { biggestGap, truthGap } from "@/lib/reports-trust";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Truth gap" };

const REASONS: [string, string][] = [
  ["View-through credit", "Someone scrolls past an ad, buys a week later from a Google search, and Meta still counts the sale."],
  ["Modeled conversions", "When tracking is blocked, platforms estimate the sales they think happened and add them to the total."],
  ["Everyone claims the same sale", "Meta, Google and TikTok each take full credit for a buyer who saw all three. Add them up and you get more sales than you made."],
  ["Their clock, their rules", "Platforms pick their own attribution windows and count on the day of the click, not the day money arrived."],
];

export default async function TruthPage({ searchParams }: PageProps<"/truth">) {
  const denied = await gatePage("page.profit");
  if (denied) return denied;
  const { workspace: ws } = await requireUser("reports.view");
  const db = await getDb();
  const p = await resolvePeriodParams(db, ws, await searchParams);
  const gap = await truthGap(db, ws, p);
  const c = gap.currency;
  const withData = gap.platforms.filter((r) => r.spendMinor > 0 || r.platformConversions > 0);
  const top = biggestGap(withData);
  const max = Math.max(0, ...withData.flatMap((r) => [r.platformValueMinor ?? 0, r.verifiedRevenueMinor]));
  const campaigns = gap.campaigns.filter((r) => r.spendMinor > 0 || r.platformConversions > 0 || r.verifiedRevenueMinor !== 0);
  const modelLabel = MODEL_LABELS[p.model] ?? p.model;

  return (
    <>
      <PageHeader title="Truth gap" description="What ad platforms claim, next to the payments you actually received">
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showCompare={false} />
      </PageHeader>
      <PageBody>
        {withData.length === 0 ? (
          <div className="rounded-xl bg-card shadow-(--elev-card)">
            <ReportEmpty icon={ScaleIcon} title="No ad platform data for this period">
              Connect Meta, Google or TikTok and sync, and AdLedger will put what each platform reports next to your real payments. Try a longer date
              range if you&rsquo;re already connected.
            </ReportEmpty>
          </div>
        ) : (
          <>
            <section aria-label="Summary" className="rounded-xl bg-card px-4 py-5 shadow-(--elev-card) sm:px-6 sm:py-6">
              <TruthHeadline gap={gap} top={top} />
            </section>

            <section aria-labelledby="by-platform" className="rounded-xl bg-card px-4 py-4 shadow-(--elev-card) sm:px-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="by-platform" className="text-body font-semibold">
                  Claimed vs verified, by platform
                </h2>
                <p className="flex items-center gap-3 text-caption text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2.5 rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--fg-faint)_0_2px,transparent_2px_4px)] ring-1 ring-fg-faint/60 ring-inset" />
                    What the platform reports
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2.5 rounded-[2px] bg-brand" />
                    Payments AdLedger can see
                  </span>
                </p>
              </div>
              <ul className="divide-y divide-border">
                {withData.map((r) => (
                  <PlatformTruth key={r.id} row={r} max={max} currency={c} />
                ))}
              </ul>
            </section>

            <section aria-labelledby="by-campaign" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 pb-3">
                <h2 id="by-campaign" className="text-body font-semibold">
                  By campaign
                </h2>
                <p className="text-caption text-muted-foreground">{dateRange(p.start, p.end, { year: true })}</p>
              </div>
              <TruthCampaignTable rows={campaigns} currency={c} modelLabel={modelLabel} />
            </section>

            <div className="grid gap-5 border-t pt-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-10">
              <section aria-labelledby="why" className="space-y-3">
                <h2 id="why" className="text-body font-semibold">
                  Why platforms claim more than you made
                </h2>
                <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {REASONS.map(([term, detail]) => (
                    <div key={term}>
                      <dt className="text-ui font-medium">{term}</dt>
                      <dd className="text-ui text-pretty text-muted-foreground">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-labelledby="how" className="space-y-2 text-ui text-pretty text-muted-foreground">
                <h2 id="how" className="text-body font-semibold text-foreground">
                  How AdLedger counts
                </h2>
                <p>
                  <span className="font-medium text-foreground">Verified</span> is every payment, net of refunds, from a buyer who clicked that
                  platform&rsquo;s ad within your {ws.attributionWindowDays}-day window. It&rsquo;s the most generous number we can back with real money,
                  so anything above it is over-claimed.
                </p>
                <p>
                  <span className="font-medium text-foreground">{modelLabel} credit</span> splits each sale between the ads in the journey, so no sale
                  is counted twice. It&rsquo;s the number to budget with; see{" "}
                  <Link href="/attribution" className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                    Attribution
                  </Link>{" "}
                  to compare models.
                </p>
              </section>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
