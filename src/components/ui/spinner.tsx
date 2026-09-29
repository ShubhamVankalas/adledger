import { cn } from "@/lib/utils"

/**
 * Orbit spinner: a brand arc circling a faint track, with a small dot orbiting the other way.
 * Sized with `size-*` (1em by default, so it scales with the surrounding text). Use `tone="current"`
 * on filled buttons, where a brand-coloured arc could clash with the button colour.
 *
 * Decorative by default (aria-hidden); pass `label` for a standalone "Loading…" announcement.
 * Under prefers-reduced-motion it renders as a static arc.
 */
function Spinner({ className, tone = "brand", label, ...props }: Omit<React.ComponentProps<"svg">, "aria-label"> & { tone?: "brand" | "current"; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      data-slot="spinner"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-[1em] shrink-0", tone === "brand" ? "text-brand" : "text-current", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.5} />
      <circle className="orbit-arc" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="15 42" />
      <g className="orbit-dot">
        <circle cx="12" cy="6.5" r="1.5" fill="currentColor" opacity={0.55} />
      </g>
    </svg>
  )
}

export { Spinner }
