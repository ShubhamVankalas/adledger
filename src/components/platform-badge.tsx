import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  meta: { label: "Meta", className: "bg-[#0866ff]/12 text-[#0866ff] dark:bg-[#4d8dff]/15 dark:text-[#7aa9ff]" },
  google: { label: "Google", className: "bg-[#ea4335]/10 text-[#d93025] dark:bg-[#ff7b6e]/15 dark:text-[#ff9a8f]" },
};

export function PlatformBadge({ platform, className }: { platform: string | null; className?: string }) {
  const s = STYLES[platform ?? ""] ?? { label: platform ?? "—", className: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10px] font-semibold tracking-wide uppercase", s.className, className)}>
      {s.label}
    </span>
  );
}
