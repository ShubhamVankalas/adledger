import { credit, creditTitle, moneyShort, moneyWhole, pct } from "@/lib/format";
import { LTV_MARKS, type PaybackReport, type PaybackRow } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { ScrollTable, SourceLabel } from "./primitives";

// LTV at day 30/60/90/180, CAC and payback by acquisition source. LTV cells that reach the
// source's CAC turn green; "—" means no customer is that old yet (too early, not zero).

const TH = "h-9 px-3 text-right text-caption font-medium whitespace-nowrap text-muted-foreground";
const TD = "h-11 px-3 text-right whitespace-nowrap tabular-nums";

export function PaybackStatus({ row }: { row: Pick<PaybackRow, "status" | "paybackDays"> }) {
  if (row.status === "paid_back") {
    return (
      <span className="inline-flex items-center rounded-[4px] bg-positive-soft px-1.5 text-caption leading-5 font-medium text-[color:var(--positive)]">
        {row.paybackDays === 0 ? "Day 0" : `${row.paybackDays} days`}
      </span>
    );
  }
  if (row.status === "not_yet") return <span className="inline-flex items-center rounded-[4px] bg-warning-soft px-1.5 text-caption leading-5 font-medium text-warning-foreground">Not yet</span>;
  return <span className="text-caption text-fg-faint">{row.status === "no_spend" ? "No ad cost" : "No customers"}</span>;
}

export function PaybackTable({ report, currency }: { report: PaybackReport; currency: string }) {
  const rows = [...report.rows.map((r) => ({ ...r, total: false })), ...(report.rows.filter((r) => r.spendMinor > 0).length > 1 ? [{ ...report.paid, key: "__paid", channel: null, platform: null, total: true }] : [])];
  return (
    <ScrollTable label="Payback and LTV by acquisition source">
      <table className="w-full min-w-[52rem] border-collapse text-ui">
        <thead>
          <tr className="border-b">
            <th scope="col" className={cn(TH, "pl-0 text-left")}>
              Acquired by
            </th>
            <th scope="col" className={TH}>
              Customers
            </th>
            <th scope="col" className={TH}>
              CAC
            </th>
            {LTV_MARKS.map((d) => (
              <th key={d} scope="col" className={TH}>
                LTV {d}d
              </th>
            ))}
            <th scope="col" className={TH}>
              Payback
            </th>
            <th scope="col" className={TH}>
              Repeat
            </th>
            <th scope="col" className={cn(TH, "pr-0")}>
              Refunds
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key} className={cn("transition-colors duration-100 hover:bg-fill/60", r.total && "border-t-2 border-border-strong font-medium")}>
              <th scope="row" className={cn(TD, "pl-0 text-left font-medium")}>
                {r.total ? "All paid platforms" : <SourceLabel id={r.key} />}
              </th>
              <td className={TD} title={creditTitle(r.customers, "customers")}>
                {credit(r.customers)}
              </td>
              <td className={cn(TD, "text-muted-foreground")}>{moneyShort(r.cacMinor, currency)}</td>
              {LTV_MARKS.map((d) => {
                const v = r.ltvAt[d];
                const covers = v !== null && r.cacMinor !== null && v >= r.cacMinor;
                return (
                  <td key={d} className={cn(TD, v === null && "text-fg-faint", covers && "text-[color:var(--positive)]")} title={v === null ? "Too early: no customer is this old yet" : moneyWhole(v, currency)}>
                    {v === null ? "—" : moneyShort(v, currency)}
                  </td>
                );
              })}
              <td className={TD}>
                <PaybackStatus row={r} />
              </td>
              <td className={TD}>{pct(r.repeatRate, 0)}</td>
              <td className={cn(TD, "pr-0", (r.refundRate ?? 0) >= 0.1 && "text-[color:var(--negative)]")}>{pct(r.refundRate, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
