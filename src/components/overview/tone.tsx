import type { Delta, DeltaTone } from "@/lib/metrics";
import { cn } from "@/lib/utils";

// Colour means money: green for gain, red for loss, muted for neutral or flat. The Quiet Ledger
// tokens (--positive/--negative) win when present; today's theme colours are the fallback.
export const TONE_TEXT: Record<DeltaTone, string> = {
  good: "text-[color:var(--positive,var(--success))]",
  bad: "text-[color:var(--negative,var(--destructive))]",
  neutral: "text-muted-foreground",
  flat: "text-muted-foreground",
  none: "text-muted-foreground",
};
export const POSITIVE_TEXT = TONE_TEXT.good;
export const NEGATIVE_TEXT = TONE_TEXT.bad;
export const POSITIVE_BG = "bg-[color:var(--positive,var(--success))]";
export const NEGATIVE_BG = "bg-[color:var(--negative,var(--destructive))]";

/** ▲ 12.4% / ▼ 3.1% / Flat, coloured by the metric's polarity. Always paired with an arrow and a label. */
export function DeltaText({ delta, className }: { delta: Delta; className?: string }) {
  if (delta.tone === "none") return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium tabular-nums", TONE_TEXT[delta.tone], className)} title={delta.label}>
      {delta.direction === "up" || delta.direction === "down" ? (
        <svg aria-hidden viewBox="0 0 8 8" className={cn("size-2 fill-current", delta.direction === "down" && "rotate-180")}>
          <path d="M4 1 7.5 7h-7z" />
        </svg>
      ) : null}
      <span aria-hidden>{delta.text}</span>
      <span className="sr-only">{delta.label}</span>
    </span>
  );
}
