import Link from "next/link";
import { cn } from "@/lib/utils";

/** Compact pill tabs under the Profit header: Profit ledger · Time to money. Keeps the filters. */
export function ProfitTabs({ active, query }: { active: "ledger" | "time"; query: string }) {
  const tabs = [
    { id: "ledger", label: "Profit ledger", href: `/profit${query}` },
    { id: "time", label: "Time to money", href: `/profit/time-to-money${query}` },
  ] as const;
  return (
    <nav aria-label="Profit views" className="flex items-center gap-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-2.5 text-ui text-muted-foreground transition-colors duration-100 hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            t.id === active && "bg-fill-active font-medium text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The query string to carry between the Profit tabs (period, model, platform, level). */
export function profitQuery(sp: Record<string, string | string[] | undefined>, keys = ["range", "from", "to", "model", "platform"]) {
  const q = new URLSearchParams();
  for (const k of keys) {
    const v = sp[k];
    if (typeof v === "string" && v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
