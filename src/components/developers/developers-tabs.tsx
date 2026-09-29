"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type DevTab = { href: string; label: string };

/** The Developers section tabs (same look as the Attribution and Customers tab rows). */
export function DevelopersTabs({ tabs }: { tabs: DevTab[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/developers" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Developers" className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max items-center gap-1">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-2.5 text-ui whitespace-nowrap text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-7",
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
