import { cn } from "@/lib/utils";

/**
 * Ink tile with the rising ledger line; the end point is the one touch of brand green.
 * `inverse` is for dark, brand-coloured surfaces (the sign-in showcase): a light tile with an ink line.
 */
export function LogoMark({ className, inverse }: { className?: string; inverse?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className={inverse ? "fill-white" : "fill-ink"} />
      <path
        d="M8 22.5 13.5 15l4 4L24 9.5"
        fill="none"
        className={inverse ? "stroke-[oklch(0.2_0.012_165)]" : "stroke-ink-foreground"}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="9.5" r="2.4" className={inverse ? "fill-[color-mix(in_oklch,var(--brand),black_25%)]" : "fill-brand"} />
    </svg>
  );
}

export function Logo({ className, inverse }: { className?: string; inverse?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark inverse={inverse} />
      <span translate="no" className={cn("text-[1.0625rem] font-semibold tracking-[-0.015em]", inverse && "text-white")}>
        Ad<span className={inverse ? "text-white/70" : "text-muted-foreground"}>Ledger</span>
      </span>
    </div>
  );
}
