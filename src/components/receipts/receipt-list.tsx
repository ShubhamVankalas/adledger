import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { channelLabel, money, moneyWhole, pct, plural } from "@/lib/format";
import type { Payback, ReceiptListRow } from "@/lib/reports-profit";
import { receiptDateTime } from "./receipt";

export function PaybackTag({ payback, currency }: { payback: Payback | null; currency: string }) {
  if (!payback) return <span className="text-caption text-muted-foreground">No contact</span>;
  if (payback.status === "paid_back") {
    return <Badge variant="positive">{payback.days === 0 ? "Paid back same day" : `Paid back in ${plural(payback.days ?? 0, "day")}`}</Badge>;
  }
  if (payback.status === "not_yet") return <Badge variant="warning">{moneyWhole(payback.remainingMinor, currency)} to go</Badge>;
  return <Badge variant="secondary">No ad cost</Badge>;
}

const COLS = "md:grid md:grid-cols-[9.5rem_minmax(0,1fr)_7rem_minmax(0,1.3fr)_6.5rem_10rem_1rem] md:items-center md:gap-4";

/**
 * Payments with their receipt summary. One DOM tree for every width: a grid row on desktop,
 * a stacked card on phones. Each row is a link to the full receipt.
 */
export function ReceiptList({ rows, currency, timeZone, query }: { rows: ReceiptListRow[]; currency: string; timeZone: string; query: string }) {
  return (
    <div>
      <div aria-hidden className={`hidden border-b px-4 pb-2 text-caption font-medium text-muted-foreground ${COLS}`}>
        <span>Paid</span>
        <span>Customer</span>
        <span className="text-right">Amount</span>
        <span>Mostly earned by</span>
        <span className="text-right">Cost to acquire</span>
        <span>Payback</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const top = r.topEarner;
          return (
            <li key={r.paymentId}>
              <Link
                href={`/receipts/${r.paymentId}${query}`}
                className={`group/row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-ui transition-colors duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:py-2.5 ${COLS}`}
              >
                <span className="order-3 text-caption text-muted-foreground md:order-none md:text-ui">
                  <time dateTime={r.at}>{receiptDateTime(r.at, timeZone)}</time>
                </span>
                <span className="order-1 min-w-0 truncate font-medium md:order-none">{r.contactName ?? <span className="text-muted-foreground">Unknown customer</span>}</span>
                <span className="num order-2 text-right font-medium md:order-none">{money(r.amountMinor, r.currency)}</span>
                <span className="order-5 flex min-w-0 items-center gap-2 md:order-none">
                  {top ? (
                    <>
                      {top.platform ? <PlatformBadge platform={top.platform} compact className="text-foreground" /> : null}
                      <span className="min-w-0 truncate">{top.platform ? top.name : top.name === "Unattributed" ? "No tracked touch" : channelLabel(top.channel)}</span>
                      <span className="num shrink-0 text-caption text-muted-foreground">
                        {pct(top.credit, 0)}
                        {top.touches > 1 ? ` · +${top.touches - 1}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No tracked touch</span>
                  )}
                </span>
                <span className="num order-6 text-right text-caption text-muted-foreground md:order-none md:text-ui md:text-foreground">
                  <span className="md:hidden">Cost </span>
                  {r.costMinor === null ? "—" : money(r.costMinor, currency)}
                </span>
                <span className="order-4 justify-self-end md:order-none md:justify-self-start">
                  <PaybackTag payback={r.payback} currency={currency} />
                </span>
                <ChevronRightIcon aria-hidden className="hidden size-4 text-fg-faint transition-colors duration-100 group-hover/row:text-foreground md:block" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
