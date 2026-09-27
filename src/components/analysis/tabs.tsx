import { cn } from "@/lib/utils";

// Tab definitions for the Attribution and Customers sections (plain module: usable from server
// components, loading states and the client tab row alike).

export type SectionTab = { href: string; label: string };

export const ATTRIBUTION_TABS: SectionTab[] = [
  { href: "/attribution", label: "Models" },
  { href: "/attribution/paths", label: "Paths" },
  { href: "/attribution/time-to-convert", label: "Time to convert" },
];

export const CUSTOMERS_TABS: SectionTab[] = [
  { href: "/customers", label: "LTV" },
  { href: "/customers/cohorts", label: "Cohorts" },
  { href: "/customers/payback", label: "Payback" },
];

/** Same row without client hooks, for loading states. */
export function SectionTabsStatic({ tabs, active, label }: { tabs: SectionTab[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <ul className="flex w-max items-center gap-1">
        {tabs.map((t) => (
          <li key={t.href}>
            <span className={cn("inline-flex h-9 items-center rounded-md px-2.5 text-ui whitespace-nowrap text-muted-foreground md:h-7", t.href === active && "bg-fill-active font-medium text-foreground")}>
              {t.label}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
