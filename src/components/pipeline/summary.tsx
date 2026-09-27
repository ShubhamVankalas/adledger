import { moneyShort, num } from "@/lib/format";
import type { PipelineSummary } from "@/lib/reports-pipeline";
import { cn } from "@/lib/utils";

/** The board's headline numbers: one quiet row, no cards (the columns carry the detail). */
export function PipelineSummaryRow({ summary, currency, className }: { summary: PipelineSummary; currency: string; className?: string }) {
  const items: { label: string; value: string; hint: string; tone?: "warning" }[] = [
    { label: "Open", value: num(summary.open), hint: "Contacts in an open stage" },
    { label: "Weighted value", value: moneyShort(summary.openWeightedMinor, currency), hint: "Each open contact's revenue, or the average customer value, times the stage's win probability" },
    { label: "Won", value: num(summary.won), hint: "Contacts in a won stage" },
    { label: "Won revenue", value: moneyShort(summary.wonValueMinor, currency), hint: "Revenue from contacts in a won stage, net of refunds" },
    { label: "Rotting", value: num(summary.rotting), hint: "Open contacts that have sat in their stage longer than its limit", tone: summary.rotting > 0 ? "warning" : undefined },
  ];
  return (
    <dl className={cn("grid grid-cols-3 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-8", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0" title={i.hint}>
          <dt className="truncate text-caption text-muted-foreground">{i.label}</dt>
          <dd className={cn("num text-title-sm", i.tone === "warning" && "text-warning-foreground")}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
