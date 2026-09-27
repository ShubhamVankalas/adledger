// Small building blocks shared by the analysis pages (paths, time to convert, cohorts, payback)
// and their Overview widgets. Server-safe: no hooks, no client imports.
import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { BrandGlyph, hasBrandIcon } from "@/components/brand-icon";
import { Card, CardContent } from "@/components/ui/card";
import { channelLabel, PLATFORM_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A number inside a sentence: foreground, medium, tabular. */
export const Num = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("font-medium text-foreground tabular-nums", className)}>{children}</span>
);

/** The one-sentence answer at the top of each analysis page (filled from SQL numbers, never an LLM). */
export function Answer({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-card px-4 py-3 text-body text-pretty text-muted-foreground shadow-(--elev-card)">
      <SparklesIcon aria-hidden className="mt-[3px] size-4 shrink-0 text-brand" strokeWidth={1.75} />
      <span>{children}</span>
    </p>
  );
}

/** Card with a title, a one-line description and an optional action on the right. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Card className={cn("min-w-0 gap-3", className)} aria-labelledby={headingId} role={id ? "region" : undefined} id={id}>
      <div className="flex flex-col gap-2.5 px-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-body font-semibold tracking-[-0.006em] text-balance">
            {title}
          </h2>
          {description ? <p className="mt-0.5 max-w-3xl text-caption/[1.125rem] text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

/** Colour swatch + label for a chart legend. */
export function LegendItem({ color, label, dashed, square }: { color: string; label: React.ReactNode; dashed?: boolean; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {square ? (
        <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: color }} />
      ) : dashed ? (
        <span aria-hidden className="w-3 border-t-[1.5px] border-dashed" style={{ borderColor: color }} />
      ) : (
        <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}

export function Legend({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground", className)}>{children}</div>;
}

/** Empty state inside a panel: icon, one headline, one line of why, optional action. */
export function PanelEmpty({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center", className)}>
      <Icon aria-hidden strokeWidth={1.75} className="mb-1 size-5 text-fg-faint" />
      <p className="text-ui font-medium text-balance">{title}</p>
      {children ? <p className="max-w-sm text-caption text-pretty text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * A journey step or acquisition source: a platform id ("meta") gets its logo and name, anything
 * else is a channel ("organic", "direct") or the unattributed bucket.
 */
export function stepLabel(step: string) {
  return PLATFORM_LABELS[step] ?? channelLabel(step);
}

export function SourceLabel({ id, className, compact }: { id: string; className?: string; compact?: boolean }) {
  const label = stepLabel(id);
  const isPlatform = id in PLATFORM_LABELS && hasBrandIcon(id);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap", className)} title={label}>
      {isPlatform ? (
        <span aria-hidden className="contents">
          <BrandGlyph id={id} className="size-3.5 shrink-0" />
        </span>
      ) : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg-faint" />
      )}
      {compact ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </span>
  );
}

/** Keyboard-scrollable wrapper for tables that may scroll sideways on phones. */
export function ScrollTable({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto overscroll-x-contain focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}

/** "3.1 days", "18 hours", "Same day"-style reading of a fractional day count. */
export function daysLabel(d: number | null | undefined, opts: { short?: boolean } = {}) {
  if (d === null || d === undefined || !Number.isFinite(d)) return "—";
  if (d < 1) {
    const h = Math.round(d * 24);
    if (h < 1) return opts.short ? "<1h" : "<1 hour";
    return opts.short ? `${h}h` : `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const v = d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
  return opts.short ? `${v}d` : `${v} ${v === 1 ? "day" : "days"}`;
}

/**
 * Segmented control whose options are links (the choice changes server data and lives in the
 * URL). Same look as the client <Segmented>.
 */
export function LinkSegmented({ label, options, className }: { label: string; options: { href: string; label: string; active: boolean }[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn("inline-flex h-9 shrink-0 items-center rounded-[7px] bg-fill p-0.5 md:h-7", className)}>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          scroll={false}
          aria-current={o.active ? "true" : undefined}
          className={cn(
            "inline-flex h-full items-center rounded-[5px] px-2.5 text-caption whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-100 hover:text-foreground",
            o.active && "bg-card font-medium text-foreground shadow-(--elev-sm)",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** Build a link to the current page with some query params changed (null removes one). */
export function withParams(path: string, sp: Record<string, string | string[] | undefined>, patch: Record<string, string | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) q.set(k, one);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** "Jul 2026" from "2026-07". */
export const monthLabel = (ym: string, opts: { short?: boolean } = {}) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: opts.short ? "2-digit" : "numeric", timeZone: "UTC" });
