import { BrandGlyph } from "@/components/brand-icon";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  microsoft: "Microsoft",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  reddit: "Reddit",
  x: "X",
  other: "Other",
};

/**
 * Platform logo + name, used in tables and lists. `compact` shows only the logo;
 * `compact="auto"` shows only the logo until the nearest `@container` is at least 28rem wide.
 */
export function PlatformBadge({ platform, className, compact }: { platform: string | null; className?: string; compact?: boolean | "auto" }) {
  const label = LABELS[platform ?? ""] ?? platform ?? "—";
  return (
    <span
      title={label}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase",
        compact === true && "px-1",
        compact === "auto" && "px-1 @md:px-1.5",
        className,
      )}
    >
      <BrandGlyph id={platform ?? "other"} className="size-3" />
      {compact === true ? <span className="sr-only">{label}</span> : compact === "auto" ? <span className="sr-only @md:not-sr-only">{label}</span> : label}
    </span>
  );
}
