import { cn } from "@/lib/utils"

// A slow (1.6s), low-contrast shimmer; static under reduced motion (globals.css stops animations).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-skeleton rounded-md bg-fill bg-[linear-gradient(90deg,var(--fill)_30%,var(--fill-hover)_50%,var(--fill)_70%)] bg-size-[200%_100%]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
