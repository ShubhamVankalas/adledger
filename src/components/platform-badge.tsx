import { BrandGlyph } from "@/components/brand-icon";
import { platformLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Platform logo + proper-case name ("Meta", "Google"), sitting inline with the surrounding text:
 * it inherits the font size and reads as muted metadata unless `className` says otherwise. `compact` shows only the logo;
 * `compact="auto"` shows only the logo until the nearest `@container` is at least 28rem wide.
 */
export function PlatformBadge({ platform, className, compact }: { platform: string | null; className?: string; compact?: boolean | "auto" }) {
  const label = platformLabel(platform);
  return (
    <span title={label} translate="no" className={cn("inline-flex min-w-0 items-center gap-1.5 font-normal whitespace-nowrap text-muted-foreground", compact === true ? "shrink-0" : "shrink", className)}>
      {/* The name is always in the text (visible or sr-only), so the logo itself stays out of the accessibility tree. */}
      <span aria-hidden className="contents">
        <BrandGlyph id={platform ?? "other"} className="size-3.5 shrink-0" />
      </span>
      {compact === true ? (
        <span className="sr-only">{label}</span>
      ) : compact === "auto" ? (
        <span className="sr-only @md:not-sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </span>
  );
}
