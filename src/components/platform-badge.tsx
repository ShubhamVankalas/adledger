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

/** Platform logo + name, used in tables and lists. `compact` shows only the logo. */
export function PlatformBadge({ platform, className, compact }: { platform: string | null; className?: string; compact?: boolean }) {
  const label = LABELS[platform ?? ""] ?? platform ?? "—";
  return (
    <span
      title={label}
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground", compact && "px-1", className)}
    >
      <BrandGlyph id={platform ?? "other"} className="size-3" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
