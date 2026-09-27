import { ArrowUpRightIcon, CircleDashedIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { channelLabel, countLabel, credit, MODEL_LABELS, money, moneyWhole, pct, plural } from "@/lib/format";
import type { AttributionModel } from "@/lib/db/schema";
import type { ContactReceipt, CostBasis, CostLine, EarnedLine, Payback, PaymentReceipt } from "@/lib/reports-profit";
import { cn } from "@/lib/utils";

// Ad Receipts: which ads earned a payment, what the customer cost, and when they paid it back.
// Server components (no client JS): the standalone /receipts/[paymentId] page renders
// <PaymentReceiptView/>, and the CRM record page embeds <ContactReceiptView/> as a tab.

/** "Jul 5, 2026, 12:04" in the workspace timezone (server-rendered, so no hydration drift). */
export function receiptDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
/** "Jul 5, 2026" in the workspace timezone. */
export function receiptDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}
/** "Jul 5" for a workspace-local YYYY-MM-DD day. */
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
/** "July" for a YYYY-MM month. */
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
const costAside = (basis: CostBasis) => (basis === "clicks" ? "Their own clicks only" : "Share of each ad’s spend that month");

/** A torn-paper rule between receipt sections. */
function Tear() {
  return <div aria-hidden className="-mx-4 border-t border-dashed border-border-strong/80 sm:-mx-5" />;
}

function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="label-caps">{children}</h3>
      {aside ? <span className="hidden text-caption text-muted-foreground sm:inline">{aside}</span> : null}
    </div>
  );
}

/** Credit share as a readable fraction of the whole: "50%", "33.3%", "100%". */
const share = (v: number) => (Math.abs(v - Math.round(v * 100) / 100) < 1e-9 ? pct(v, 0) : pct(v, 1));

function EarnerName({ line }: { line: EarnedLine }) {
  if (!line.touchpointId) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <CircleDashedIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
        <span className="truncate text-muted-foreground">No tracked touch</span>
      </span>
    );
  }
  if (line.platform) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <PlatformBadge platform={line.platform} compact className="text-foreground" />
          <span className="truncate font-medium">{line.adName ?? line.campaignName ?? "Unknown ad"}</span>
        </span>
        {line.adName && line.campaignName ? <span className="truncate pl-5.5 text-caption text-muted-foreground">{line.campaignName}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{channelLabel(line.channel)}</span>
      {line.source ? (
        <span className="truncate text-caption text-muted-foreground" translate="no">
          {line.source}
        </span>
      ) : null}
    </span>
  );
}

/** "Earned by": the credited share of revenue per ad / channel, with a total that equals the money. */
function EarnedList({ lines, totalMinor, currency, timeZone, totalLabel }: { lines: EarnedLine[]; totalMinor: number; currency: string; timeZone: string; totalLabel: string }) {
  if (lines.length === 0) {
    return <p className="text-ui text-muted-foreground">No credit recorded yet. Attribution runs after each sync; check back in a few minutes.</p>;
  }
  return (
    <table className="w-full text-ui">
      <caption className="sr-only">Who earned this revenue</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Ad or channel</th>
          <th scope="col">Share</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {lines.map((l) => (
          <tr key={l.key} className="align-top">
            <td className="max-w-0 py-2 pr-3">
              <EarnerName line={l} />
              {l.touchedAt ? <span className="sr-only">clicked {receiptDate(l.touchedAt, timeZone)}</span> : null}
            </td>
            <td className="num w-16 py-2 pr-3 text-right text-muted-foreground">{share(l.credit)}</td>
            <td className="num w-28 py-2 text-right font-medium">{money(l.revenueMinor, currency)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-foreground/15">
          <th scope="row" className="pt-2 text-left font-medium">
            {totalLabel}
          </th>
          <td className="num pt-2 pr-3 text-right text-muted-foreground">100%</td>
          <td className="num pt-2 text-right font-semibold">{money(totalMinor, currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** What the customer cost: each credited click priced from its ad-day. */
function CostList({ lines, costMinor, currency }: { lines: CostLine[]; costMinor: number; currency: string }) {
  if (lines.length === 0) {
    return (
      <p className="text-ui text-pretty text-muted-foreground">
        Nothing: no paid ad click is credited with this customer, so they cost {money(0, currency)} in ad spend. They found you on their own, through a
        channel you don&rsquo;t pay for, or before tracking started.
      </p>
    );
  }
  return (
    <table className="w-full text-ui">
      <caption className="sr-only">Ad spend allocated to this customer</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Ad and day</th>
          <th scope="col">Clicks credited</th>
          <th scope="col">Cost</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {lines.map((l) => {
          const detail =
            l.poolSpendMinor === null
              ? `${shortDay(l.day)} · no spend recorded ${l.basis === "clicks" ? "that day" : "that month"}`
              : l.basis === "clicks"
                ? `${shortDay(l.day)} · ${credit(l.credit)} of ${plural(l.poolClicks ?? 0, "click")}${l.poolClicks ? ` at ${money(Math.round(l.poolSpendMinor / l.poolClicks), currency)}` : ""}`
                : `Clicked ${shortDay(l.day)} · ${credit(l.credit)} of ${countLabel(l.poolCredits, "customer")} sharing ${monthName(l.pool)}’s ${moneyWhole(l.poolSpendMinor, currency)}`;
          return (
            <tr key={l.touchpointId} className="align-top">
              <td className="max-w-0 py-2 pr-3">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformBadge platform={l.platform} compact className="text-foreground" />
                  <span className="truncate font-medium">{l.adName ?? "Unknown ad"}</span>
                </span>
                <span className="block pl-5.5 text-caption text-pretty text-muted-foreground">{detail}</span>
              </td>
              <td className="num w-28 py-2 text-right font-medium">{money(l.costMinor, currency)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-foreground/15">
          <th scope="row" className="pt-2 text-left font-medium">
            Acquisition cost
          </th>
          <td className="num pt-2 text-right font-semibold">{money(costMinor, currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** Payback status: a filled meter of lifetime net revenue against the acquisition cost. */
function PaybackBlock({
  payback,
  costMinor,
  netMinor,
  currency,
  timeZone,
  profit,
}: {
  payback: Payback;
  costMinor: number;
  netMinor: number;
  currency: string;
  timeZone: string;
  profit: ContactReceipt["profit"];
}) {
  const ratio = costMinor > 0 ? Math.max(0, netMinor) / costMinor : null;
  const fill = ratio === null ? 1 : Math.min(1, ratio);
  const headline =
    payback.status === "paid_back"
      ? `Paid back ${receiptDate(payback.at!, timeZone)}`
      : payback.status === "not_yet"
        ? `${money(payback.remainingMinor, currency)} left to earn back`
        : "No ad cost to earn back";
  const detail =
    payback.status === "paid_back"
      ? payback.days === 0
        ? "The same day as their first paid click."
        : `${plural(payback.days ?? 0, "day")} after their first paid click.`
      : payback.status === "not_yet"
        ? `They have paid ${money(Math.max(0, netMinor), currency)} of the ${money(costMinor, currency)} their ads cost.`
        : "Every payment from this customer is margin before costs.";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className={cn("text-body font-medium", payback.status === "paid_back" && "text-positive")}>{headline}</p>
        {ratio !== null ? <p className="num text-caption text-muted-foreground">{ratio >= 10 ? ">10" : ratio.toFixed(1)}× its cost returned</p> : null}
      </div>
      <div
        role="meter"
        aria-label="Revenue earned back against acquisition cost"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-fill"
      >
        <div
          className={cn("h-full origin-left rounded-full", payback.status === "not_yet" ? "bg-warning" : "bg-positive")}
          style={{ transform: `scaleX(${fill})` }}
        />
      </div>
      <p className="text-caption text-pretty text-muted-foreground">{detail}</p>
      {profit ? (
        <dl className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <dt className="text-caption text-muted-foreground">Contribution to date</dt>
            <dd className="num text-ui font-medium">{money(profit.contributionMinor, currency)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Profit after ad cost</dt>
            <dd className={cn("num text-ui font-medium", profit.profitMinor < 0 ? "text-negative" : "text-positive")}>{money(profit.profitMinor, currency)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function ModelNote({ model }: { model: AttributionModel }) {
  return <>{MODEL_LABELS[model] ?? model} credit</>;
}

/** The receipt of one payment or refund. */
export function PaymentReceiptView({
  receipt: r,
  timeZone,
  contactHref,
  costControl,
}: {
  receipt: PaymentReceipt;
  timeZone: string;
  contactHref?: string | null;
  /** Optional control shown with the cost section (e.g. the share of spend / clicks only switch). */
  costControl?: React.ReactNode;
}) {
  const p = r.payment;
  const c = r.contact;
  const refund = p.type === "refund";
  return (
    <article aria-labelledby="receipt-amount" className="relative overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
      {/* Receipt paper: a thin brand edge at the top, like the torn-off top of a till roll. */}
      <div aria-hidden className="h-1 bg-[repeating-linear-gradient(90deg,var(--brand)_0_10px,transparent_10px_14px)] opacity-60" />
      <div className="space-y-5 px-4 py-5 sm:px-5">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ReceiptTextIcon aria-hidden className="size-3.5" /> {refund ? "Refund" : "Payment"} · <span className="capitalize">{p.source}</span>
            </span>
            <span className="font-mono text-mono" translate="no" title={p.id}>
              {p.id.slice(0, 8)}
            </span>
          </div>
          <p id="receipt-amount" className={cn("num text-kpi-lg", refund && "text-negative")}>
            {money(p.amountMinor, p.currency)}
          </p>
          <p className="text-ui text-muted-foreground">
            <time dateTime={p.at}>{receiptDateTime(p.at, timeZone)}</time>
            {c ? (
              <>
                {" · "}
                {contactHref ? (
                  <Link href={contactHref} className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
                    {c.contact.name ?? c.contact.email ?? "Customer"}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{c.contact.name ?? c.contact.email ?? "Customer"}</span>
                )}
              </>
            ) : (
              " · no contact matched"
            )}
          </p>
        </header>

        <Tear />
        <section aria-label="Earned by" className="space-y-2">
          <SectionLabel aside={<ModelNote model={r.model} />}>{refund ? "Taken back from" : "Earned by"}</SectionLabel>
          <EarnedList lines={r.earnedBy} totalMinor={p.amountMinor} currency={p.currency} timeZone={timeZone} totalLabel={refund ? "Total refunded" : "Total paid"} />
        </section>

        {c ? (
          <>
            <Tear />
            <section aria-label="What this customer cost" className="space-y-2">
              <SectionLabel aside={c.costLines.length ? costAside(c.basis) : undefined}>What this customer cost</SectionLabel>
              {costControl ? <div>{costControl}</div> : null}
              <CostList lines={c.costLines} costMinor={c.costMinor} currency={c.currency} />
            </section>
            <Tear />
            <section aria-label="Payback" className="space-y-2">
              <SectionLabel aside={`${plural(c.lifetime.payments, "payment")} · ${money(c.lifetime.netMinor, c.currency)} net`}>Payback</SectionLabel>
              <PaybackBlock payback={c.payback} costMinor={c.costMinor} netMinor={c.lifetime.netMinor} currency={c.currency} timeZone={timeZone} profit={c.profit} />
            </section>
          </>
        ) : (
          <>
            <Tear />
            <p className="text-ui text-pretty text-muted-foreground">
              This payment has no matching contact (no email or customer id we could link), so there&rsquo;s no journey to price. It still counts in
              your revenue totals.
            </p>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * A contact's lifetime receipt (for the CRM record page's Receipt tab): what they cost, what they
 * paid, which ads earned it and when they paid their ads back. `paymentHref` links each payment
 * to its own receipt.
 */
export function ContactReceiptView({
  receipt: r,
  timeZone,
  paymentHref = (id) => `/receipts/${id}`,
}: {
  receipt: ContactReceipt;
  timeZone: string;
  paymentHref?: (paymentId: string) => string;
}) {
  const c = r.currency;
  return (
    <article aria-label="Ad receipt" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
      <div aria-hidden className="h-1 bg-[repeating-linear-gradient(90deg,var(--brand)_0_10px,transparent_10px_14px)] opacity-60" />
      <div className="space-y-5 px-4 py-5 sm:px-5">
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Cost to acquire", money(r.costMinor, c)],
            ["Paid to date", money(r.lifetime.netMinor, c)],
            ["Payback", r.payback.status === "paid_back" ? (r.payback.days === 0 ? "Same day" : plural(r.payback.days ?? 0, "day")) : r.payback.status === "not_yet" ? "Not yet" : "—"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-caption text-muted-foreground">{label}</dt>
              <dd className="num truncate text-title-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <Tear />
        <section aria-label="Earned by" className="space-y-2">
          <SectionLabel aside={<ModelNote model={r.model} />}>Earned by</SectionLabel>
          <EarnedList lines={r.earnedBy} totalMinor={r.lifetime.netMinor} currency={c} timeZone={timeZone} totalLabel="Lifetime net" />
        </section>
        <Tear />
        <section aria-label="What this customer cost" className="space-y-2">
          <SectionLabel aside={r.costLines.length ? costAside(r.basis) : undefined}>What this customer cost</SectionLabel>
          <CostList lines={r.costLines} costMinor={r.costMinor} currency={c} />
        </section>
        <Tear />
        <section aria-label="Payback" className="space-y-2">
          <SectionLabel>Payback</SectionLabel>
          <PaybackBlock payback={r.payback} costMinor={r.costMinor} netMinor={r.lifetime.netMinor} currency={c} timeZone={timeZone} profit={r.profit} />
        </section>
        {r.payments.length ? (
          <>
            <Tear />
            <section aria-label="Payments" className="space-y-1">
              <SectionLabel>Payments</SectionLabel>
              <ul className="divide-y divide-border">
                {r.payments.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={paymentHref(p.id)}
                      className="group/pay -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-ui transition-colors duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        <time dateTime={p.at}>{receiptDate(p.at, timeZone)}</time>
                        {p.type === "refund" ? " · refund" : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("num font-medium", p.type === "refund" && "text-negative")}>{money(p.amountMinor, p.currency)}</span>
                        <ArrowUpRightIcon aria-hidden className="size-3.5 text-fg-faint transition-colors duration-100 group-hover/pay:text-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </article>
  );
}
