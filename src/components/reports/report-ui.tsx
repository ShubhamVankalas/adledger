// Small building blocks shared by the Performance, Model comparison and LTV reports.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Opaque tints for sticky table cells (sticky cells need a solid background so rows
 * scrolling underneath don't show through).
 */
export const STICKY_HEAD_BG =
  "bg-[color-mix(in_oklab,var(--color-muted)_60%,var(--color-card))]";
export const STICKY_ROW_BG =
  "bg-card group-hover/row:bg-[color-mix(in_oklab,var(--color-muted)_70%,var(--color-card))]";
export const ROW_HOVER =
  "group/row hover:bg-[color-mix(in_oklab,var(--color-muted)_70%,var(--color-card))]";

/** One labelled number in a phone card. */
export function Stat({
  label,
  value,
  className,
  emphasis,
}: {
  label: string;
  value: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="label-caps truncate">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular mt-0.5 truncate",
          emphasis ? "text-base font-semibold" : "text-sm font-medium",
          className,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Friendly empty state inside a report card or list. */
export function ReportEmpty({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-1.5 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/5">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <p className="max-w-md text-sm font-semibold text-balance break-words">{title}</p>
      {children ? (
        <div className="max-w-sm text-[0.8125rem] leading-5 text-pretty text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}
