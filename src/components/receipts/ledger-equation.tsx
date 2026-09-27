import { money, moneyWhole, pct, plural } from "@/lib/format";
import type { AcquisitionLedger } from "@/lib/reports-profit";

/**
 * "Ad spend = customer costs + unallocated", with one stacked bar: the proof that receipts add up.
 * Every term comes from acquisitionLedger(); the equation holds to the minor unit.
 */
export function LedgerEquation({ ledger: l, control }: { ledger: AcquisitionLedger; control?: React.ReactNode }) {
  const c = l.currency;
  const allocatedShare = l.spendMinor > 0 ? l.allocatedMinor / l.spendMinor : 0;
  const perCustomer = l.customers > 0 ? Math.round(l.allocatedMinor / l.customers) : null;
  const share = l.basis === "share";
  const terms = [
    { label: "Ad spend", value: moneyWhole(l.spendMinor, c), exact: money(l.spendMinor, c), note: "every ad-day in the period" },
    {
      label: "Customer costs",
      value: moneyWhole(l.allocatedMinor, c),
      exact: money(l.allocatedMinor, c),
      note: `${plural(l.customers, "customer")}${perCustomer !== null ? ` · ${moneyWhole(perCustomer, c)} each on average` : ""}`,
    },
    {
      label: "Unallocated",
      value: moneyWhole(l.unallocatedMinor, c),
      exact: money(l.unallocatedMinor, c),
      note: share ? "ads that brought no customer that month" : "clicks that haven’t bought",
    },
  ];
  return (
    <section aria-labelledby="ledger-eq" className="rounded-xl bg-card px-4 py-4 shadow-(--elev-card) sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="ledger-eq" className="text-body font-semibold">
          Where the ad spend went
        </h2>
        {control}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-end sm:gap-4">
        {terms.map((t, i) => (
          <div key={t.label} className="contents">
            {i > 0 ? (
              <span aria-hidden className="hidden pb-5 text-title font-normal text-fg-faint sm:block">
                {i === 1 ? "=" : "+"}
              </span>
            ) : null}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                {i > 0 ? <span aria-hidden className={i === 1 ? "size-2 rounded-[2px] bg-brand" : "size-2 rounded-[2px] bg-border-strong"} /> : null}
                {i === 1 ? <span className="sr-only">equals</span> : i === 2 ? <span className="sr-only">plus</span> : null}
                {t.label}
              </p>
              <p className="num text-kpi" title={t.exact}>
                {t.value}
              </p>
              <p className="truncate text-caption text-muted-foreground">{t.note}</p>
            </div>
          </div>
        ))}
      </div>
      <div role="img" aria-label={`${pct(allocatedShare)} of ad spend is priced into customers`} className="mt-4 flex h-2 overflow-hidden rounded-full bg-border-strong/70">
        <div className="h-full bg-brand" style={{ width: `${allocatedShare * 100}%` }} />
      </div>
      <p className="mt-2 text-caption text-pretty text-muted-foreground">
        {share ? (
          <>
            {pct(allocatedShare)} of spend is shared out between the customers each ad brought in, month by month and by attribution credit. The rest
            went on ads that didn&rsquo;t bring a customer that month.
          </>
        ) : (
          <>
            {pct(allocatedShare)} of spend paid for the clicks of people who became customers. The rest paid for clicks that haven&rsquo;t bought
            (yet){l.noClickMinor > 0 ? `, including ${moneyWhole(l.noClickMinor, c)} on ad-days with no clicks at all` : ""}.
          </>
        )}
      </p>
    </section>
  );
}
