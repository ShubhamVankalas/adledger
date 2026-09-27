import { money, moneyWhole, pct } from "@/lib/format";
import type { ProfitLedger } from "@/lib/reports-profit";
import { cn } from "@/lib/utils";

type Step = { label: string; hint?: string; delta?: number; total?: number; kind: "start" | "minus" | "subtotal" };

/**
 * The P&L as a horizontal waterfall that reads like a statement: each cost floats where the
 * running total drops, subtotals sit on the zero line. Plain HTML (no chart library), so it
 * prints, scales to a phone and reads well with a screen reader (it is a table).
 */
export function ProfitWaterfall({ ledger: l }: { ledger: ProfitLedger }) {
  const c = l.currency;
  const ue = l.unitEconomics;
  const steps: Step[] = [
    { label: "Gross sales", hint: `${l.orders.toLocaleString("en-US")} payments`, total: l.grossSalesMinor, kind: "start" },
    { label: "Refunds", delta: l.refundsMinor, kind: "minus" },
    { label: "Net revenue", total: l.netRevenueMinor, kind: "subtotal" },
    { label: "Cost of goods", hint: ue.configured ? `${pct((10_000 - ue.grossMarginBps) / 10_000)} of net revenue` : "not set", delta: -l.cogsMinor, kind: "minus" },
    { label: "Payment fees", hint: ue.configured ? `${pct(ue.feeBps / 10_000)}${ue.feeFixedMinor ? ` + ${money(ue.feeFixedMinor, c)}` : ""} per payment` : "not set", delta: -l.feesMinor, kind: "minus" },
    { label: "Shipping", hint: ue.configured ? `${money(ue.shippingPerOrderMinor, c)} per order` : "not set", delta: -l.shippingMinor, kind: "minus" },
    { label: "Contribution", total: l.contributionMinor, kind: "subtotal" },
    { label: "Ad spend", delta: -l.spendMinor, kind: "minus" },
    { label: "Profit after ads", total: l.profitAfterAdsMinor, kind: "subtotal" },
  ];
  // Running total → a [from, to] span for every row.
  let running = 0;
  const spans = steps.map((s) => {
    if (s.kind === "minus") {
      const from = running;
      running += s.delta ?? 0;
      return { from, to: running };
    }
    running = s.total ?? 0;
    return { from: 0, to: running };
  });
  const lo = Math.min(0, ...spans.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(1, ...spans.map((s) => Math.max(s.from, s.to)));
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const zero = x(0);

  return (
    <table className="w-full text-ui">
      <caption className="sr-only">Profit and loss for the period</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Chart</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => {
          const span = spans[i];
          const left = x(Math.min(span.from, span.to));
          const width = Math.max(0.4, Math.abs(x(span.to) - x(span.from)));
          const amount = s.kind === "minus" ? (s.delta ?? 0) : (s.total ?? 0);
          const final = i === steps.length - 1;
          const negative = s.kind !== "minus" && amount < 0;
          return (
            <tr key={s.label} className={cn(s.kind === "subtotal" && "border-t border-border", final && "border-t-foreground/20")}>
              <th scope="row" className={cn("w-[34%] py-2 pr-3 text-left align-middle font-normal sm:w-[26%]", s.kind !== "minus" && "font-medium")}>
                <span className="block truncate">{s.label}</span>
                {s.hint ? <span className="block truncate text-caption text-muted-foreground">{s.hint}</span> : null}
              </th>
              <td className="py-2 align-middle" aria-hidden>
                <div className="relative h-5">
                  <div className="absolute inset-y-[-8px] w-px bg-border-strong" style={{ left: `${zero}%` }} />
                  <div
                    className={cn(
                      "absolute inset-y-0.5 rounded-[3px]",
                      s.kind === "start" && "bg-chart-revenue/80",
                      s.kind === "minus" && (s.label === "Ad spend" ? "bg-chart-spend/70" : "bg-fill-active ring-1 ring-border-strong ring-inset"),
                      s.kind === "subtotal" && (negative ? "bg-negative/80" : final ? "bg-positive" : "bg-chart-revenue"),
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </div>
              </td>
              <td
                className={cn(
                  "num w-[26%] py-2 pl-3 text-right align-middle sm:w-[16%]",
                  s.kind === "minus" && "text-muted-foreground",
                  s.kind !== "minus" && "font-medium",
                  final && (negative ? "text-negative" : "text-positive"),
                )}
                title={money(amount, c)}
              >
                {s.hint === "not set" ? (
                  <span aria-label="not set">—</span>
                ) : (
                  <>
                    {s.kind === "minus" && amount !== 0 ? "−" : ""}
                    {moneyWhole(s.kind === "minus" ? Math.abs(amount) : amount, c)}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
