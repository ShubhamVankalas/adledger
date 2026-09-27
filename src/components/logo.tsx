import { cn } from "@/lib/utils";

/** Ink tile with the rising ledger line; the end point is the one touch of brand green. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-ink" />
      <path d="M8 22.5 13.5 15l4 4L24 9.5" fill="none" className="stroke-ink-foreground" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9.5" r="2.4" className="fill-brand" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span translate="no" className="text-[1.0625rem] font-semibold tracking-[-0.015em]">
        Ad<span className="text-muted-foreground">Ledger</span>
      </span>
    </div>
  );
}
