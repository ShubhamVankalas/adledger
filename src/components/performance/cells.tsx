import { credit, pct, signedPct } from "@/lib/format";
import { ratioX } from "@/lib/metrics";
import type { PerfRowV2 } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";
import {
  deltaTone,
  formatValue,
  roasBar,
  statusLabel,
  stoplight,
  type ColumnDef,
  type DeltaTone,
  type PerfTargets,
  type Stoplight,
} from "./columns";

// Small presentational pieces shared by the table, the phone cards and the peek sheet.

const TONE: Record<DeltaTone, string> = {
  good: "text-positive",
  bad: "text-negative",
  neutral: "text-muted-foreground",
  flat: "text-muted-foreground",
};

/** ▲ 12% / ▼ 3.1% / Flat under a value. Colour follows the column's polarity; spend stays neutral. */
export function DeltaLine({ change, polarity, className }: { change: number | null | undefined; polarity: ColumnDef["polarity"]; className?: string }) {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return <span className={cn("block text-micro font-normal text-fg-faint", className)} aria-hidden>&nbsp;</span>;
  }
  const tone = deltaTone(change, polarity);
  const text = tone === "flat" ? "Flat" : Math.abs(change) >= 10 ? ">999%" : pct(Math.abs(change), Math.abs(change) < 0.1 ? 1 : 0);
  const label = tone === "flat" ? `Flat vs comparison (${signedPct(change)})` : `${change > 0 ? "Up" : "Down"} ${pct(Math.abs(change), 1)} vs comparison`;
  return (
    <span className={cn("flex items-center justify-end gap-0.5 text-micro font-medium", TONE[tone], className)} title={label}>
      {tone !== "flat" ? (
        <svg aria-hidden viewBox="0 0 8 8" className={cn("size-[7px] fill-current", change < 0 && "rotate-180")}>
          <path d="M4 1 7.5 7h-7z" />
        </svg>
      ) : null}
      <span aria-hidden>{text}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const LIGHT: Record<Stoplight, { dot: string; word: string }> = {
  good: { dot: "bg-positive", word: "On target" },
  warn: { dot: "bg-warning", word: "Close to target" },
  bad: { dot: "bg-negative", word: "Off target" },
};

/** Green / amber / red dot against a workspace target, always with a text label for assistive tech. */
export function StoplightDot({ light, target, className }: { light: Stoplight; target: string; className?: string }) {
  const { dot, word } = LIGHT[light];
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)} title={`${word} (target ${target})`}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      <span className="sr-only">{`${word}, target ${target}.`}</span>
    </span>
  );
}

/** Status pill: Active in brand green, Paused muted, anything else as plain text. */
export function StatusPill({ status, className }: { status: string | null; className?: string }) {
  const s = statusLabel(status);
  if (!s) return <span className={cn("text-fg-faint", className)}>—</span>;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-micro font-medium whitespace-nowrap",
        s.tone === "active" ? "bg-brand-soft text-brand-foreground" : "bg-fill text-muted-foreground",
        className,
      )}
    >
      {s.tone === "active" ? <span aria-hidden className="size-1 rounded-full bg-current" /> : null}
      {s.label}
    </span>
  );
}

const targetText = (key: keyof PerfTargets, v: number, currency: string) =>
  key === "roas" || key === "ncRoas" ? ratioX(v) : formatValue("money", v, currency);

/** The stoplight for one cell, when the column has a target. */
export function cellLight(col: ColumnDef, row: Pick<PerfRowV2, "roas" | "cacMinor" | "cplMinor" | "ncRoas">, targets: PerfTargets, currency: string) {
  const key = col.key as keyof PerfTargets;
  if (!(key in targets)) return null;
  const target = targets[key];
  const light = stoplight(row[key], target, col.polarity);
  return light && target ? { light, target: targetText(key, target, currency) } : null;
}

/** 3px ROAS bar with a tick at the target (or break-even). */
export function RoasBar({ value, max, target, className }: { value: number | null; max: number; target?: number; className?: string }) {
  const w = roasBar(value, max, target);
  const t = target && target > 0 ? target : 1;
  const scale = Math.max(Math.min(max, 2 * t), t);
  const tick = Math.min(1, t / scale);
  return (
    <span aria-hidden className={cn("relative block h-[3px] w-12 rounded-full bg-fill", className)}>
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", (value ?? 0) >= t ? "bg-positive" : "bg-negative/70")}
        style={{ width: `${(w * 100).toFixed(1)}%` }}
      />
      <span className="absolute -top-[2px] -bottom-[2px] w-px bg-fg-faint" style={{ left: `calc(${(tick * 100).toFixed(1)}% - 0.5px)` }} />
    </span>
  );
}

/** "94 vs 41" under a platform gap: what the platform claims next to what AdLedger verified. */
export function gapDetail(row: Pick<PerfRowV2, "platformConversions" | "verifiedConversions">): string {
  return `${credit(row.platformConversions ?? 0)} vs ${credit(row.verifiedConversions ?? 0)}`;
}

/** Sentence for a gap tooltip: "Meta reported 94 conversions; AdLedger verified 41." */
export function gapSentence(platform: string, row: Pick<PerfRowV2, "platformConversions" | "verifiedConversions" | "platformGap">): string {
  const claimed = credit(row.platformConversions ?? 0);
  const verified = credit(row.verifiedConversions ?? 0);
  if (row.platformGap === null) {
    return (row.platformConversions ?? 0) > 0
      ? `${platform} reported ${claimed} conversions; AdLedger hasn't verified any yet.`
      : `${platform} didn't report conversions for this period.`;
  }
  return `${platform} reported ${claimed} conversions; AdLedger verified ${verified} (${signedPct(row.platformGap, 0)}).`;
}
