"use client";

import { BarChart3Icon, LayoutDashboardIcon, MenuIcon, SparklesIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "cn";
import { useSidebar } from "@/components/ui/sidebar";

const TABS = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/performance", label: "Performance", icon: BarChart3Icon },
  { href: "/contacts", label: "Contacts", icon: UsersIcon },
  { href: "/insights", label: "Insights", icon: SparklesIcon },
] as const;

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

const item = "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Bottom tab bar for phones (below the md breakpoint, where the sidebar becomes a sheet).
 * "More" opens that sidebar sheet for settings, workspaces and account actions.
 * Renders a spacer too, so the last content on the page is never hidden behind the bar.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { openMobile, setOpenMobile } = useSidebar();
  const onTab = TABS.some((t) => isActive(pathname, t.href));

  // Close the "More" sheet once a link inside it navigates somewhere.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <>
      <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
      <nav
        aria-label="Primary"
        data-slot="mobile-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur supports-[backdrop-filter]:bg-background/75 md:hidden"
      >
        <ul className="flex h-16 items-stretch gap-1 px-2">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(item, active ? "text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openMobile}
              onClick={() => setOpenMobile(true)}
              className={cn(item, !onTab || openMobile ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <MenuIcon className="size-5" aria-hidden />
              <span className="truncate">More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
