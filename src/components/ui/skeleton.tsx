import { cn } from "@/lib/utils"

// A --fill block with a brand-tinted highlight sweeping across it (see `.skeleton` in globals.css).
// The sweep is compositor-only and stops under reduced motion.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("skeleton rounded-md", className)} {...props} />
}

/** A paragraph of skeleton lines; the last one is shorter, like real text. */
function SkeletonText({ lines = 3, className, lineClassName }: { lines?: number; className?: string; lineClassName?: string }) {
  return (
    <div aria-hidden className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full", lineClassName)} />
      ))}
    </div>
  )
}

/** A card frame for placeholders, so they read as the cards that are about to appear rather than grey slabs. */
function SkeletonCard({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div aria-hidden className={cn("surface-card rounded-xl p-4", className)}>
      {children}
    </div>
  )
}

/** Card title + description placeholder. */
function SkeletonHead({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("space-y-2", className)}>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-3 w-56 max-w-full" />
    </div>
  )
}

/** KPI tile: label, big number, delta line. */
function SkeletonKpi({ className, spark = false }: { className?: string; spark?: boolean }) {
  return (
    <SkeletonCard className={cn("flex h-[7.25rem] flex-col rounded-lg px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="size-6 rounded-md" />
      </div>
      <Skeleton className="mt-3 h-6 w-24 max-w-full" />
      <Skeleton className="mt-2.5 h-3 w-20 max-w-full" />
      {spark ? <SkeletonSpark className="mt-auto hidden md:block" /> : null}
    </SkeletonCard>
  )
}

// A fixed, believable wave so charts don't all look identical (values are in a 0-100 box).
const WAVE = [46, 52, 41, 58, 63, 55, 68, 74, 62, 70, 82, 76, 88, 79, 92]

function wavePath(w: number, h: number, values = WAVE) {
  const step = w / (values.length - 1)
  return values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)} ${(h - (v / 100) * h).toFixed(1)}`).join("")
}

/** A thin line silhouette for the bottom of a KPI tile. */
function SkeletonSpark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 24" preserveAspectRatio="none" className={cn("h-6 w-full text-fill-active", className)}>
      <path d={wavePath(160, 22)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * A chart wireframe: gridlines, a faint area silhouette and axis ticks, with the shimmer sweeping over
 * it. `variant="bars"` draws columns instead of an area.
 */
function SkeletonChart({ className, variant = "area" }: { className?: string; variant?: "area" | "bars" }) {
  return (
    <div aria-hidden className={cn("skeleton relative h-44 w-full overflow-hidden rounded-lg bg-transparent sm:h-60", className)}>
      {/* Gridlines + y-axis ticks */}
      <div className="absolute inset-0 flex flex-col justify-between py-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="h-2 w-8 rounded-sm bg-fill" />
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}
      </div>
      {/* Data silhouette */}
      <div className="absolute inset-y-2 right-1 left-11 sm:right-2">
        {variant === "bars" ? (
          <div className="flex h-full items-end gap-[3%] px-[1%]">
            {WAVE.map((v, i) => (
              <span key={i} className="flex-1 rounded-t-[3px] bg-fill" style={{ height: `${v * 0.9}%` }} />
            ))}
          </div>
        ) : (
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="size-full text-fill">
            <path d={`${wavePath(300, 96)}L300 100L0 100Z`} fill="currentColor" opacity={0.55} />
            <path d={wavePath(300, 96)} fill="none" stroke="var(--fill-active)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
    </div>
  )
}

/**
 * Table wireframe: a header strip and `rows` rows whose cells vary in width. `cols` describes the
 * cells after the first (flexible) one: a Tailwind width class each, prefix with `hidden sm:block`
 * to hide a column on phones.
 */
function SkeletonRows({
  rows = 8,
  cols = ["w-16", "hidden w-16 sm:block", "w-12"],
  lead = false,
  className,
  rowClassName,
}: {
  rows?: number
  cols?: string[]
  /** An avatar circle before the first cell (contacts, campaigns). */
  lead?: boolean
  className?: string
  rowClassName?: string
}) {
  const firstWidths = [62, 48, 70, 55, 66, 44, 58]
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-4 border-t px-3 py-3", rowClassName)}>
          {lead ? <Skeleton className="size-6 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 max-w-64" style={{ width: `${firstWidths[i % firstWidths.length]}%` }} />
          </div>
          {cols.map((c, j) => (
            <Skeleton key={j} className={cn("h-4", c)} />
          ))}
        </div>
      ))}
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonChart, SkeletonHead, SkeletonKpi, SkeletonRows, SkeletonSpark, SkeletonText }
