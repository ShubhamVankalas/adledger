"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SectionTab } from "./tabs";

// The compact tab row under the page header (brief §2.5: 28px pills, 6px radius, active =
// fill-active + ink). Switching tabs keeps the period, comparison, model and platform, so the
// same slice of data follows you from Models to Paths to Time to convert.

/** Query params that describe "which data" rather than "which view", carried across tabs. */
const CARRY = ["range", "from", "to", "compare", "model", "platform"] as const;

export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const carried = new URLSearchParams();
  for (const k of CARRY) {
    const v = sp.get(k);
    if (v) carried.set(k, v);
  }
  const qs = carried.toString();
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none]">
      <ul className="flex w-max items-center gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={qs ? `${t.href}?${qs}` : t.href}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-2.5 text-ui whitespace-nowrap text-muted-foreground transition-colors duration-100 hover:bg-fill-hover hover:text-foreground md:h-7",
                  active && "bg-fill-active font-medium text-foreground hover:bg-fill-active",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
