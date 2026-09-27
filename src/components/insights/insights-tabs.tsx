"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

export type InsightsTab = "reports" | "ask" | "alerts";

/** Compact pill tabs under the page header. The tab is in the URL (?tab=), so every view is linkable. */
export function InsightsTabs({ active, alertCount, showAsk }: { active: InsightsTab; alertCount: number; showAsk: boolean }) {
  const router = useRouter();
  useHotkeys(
    showAsk && active !== "ask"
      ? [{ id: "insights.ask.focus", keys: "a", label: "Ask a question", group: "Insights", run: () => router.push("/insights?tab=ask") }]
      : [],
  );
  const tabs: { key: InsightsTab; label: string; href: string; count?: number }[] = [
    { key: "reports", label: "Reports", href: "/insights" },
    ...(showAsk ? [{ key: "ask" as const, label: "Ask", href: "/insights?tab=ask" }] : []),
    { key: "alerts", label: "Alerts", href: "/insights?tab=alerts", count: alertCount },
  ];
  return (
    <nav aria-label="Insights" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max items-center gap-1">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-ui transition-colors duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-9",
                  on ? "bg-fill-active font-medium text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground",
                )}
              >
                {t.label}
                {t.count ? (
                  <span className="num rounded-full bg-warning-soft px-1.5 text-micro text-warning-foreground">
                    {t.count}
                    <span className="sr-only"> triggered</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
