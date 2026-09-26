"use client";

import { BarChart3Icon, LayoutDashboardIcon, MenuIcon, SparklesIcon, UsersIcon, type LucideIcon } from "lucide-react";
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

const item =
  "group/tab flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl pt-1.5 pb-1 text-[11px] leading-none font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
        active ? "bg-primary/12 text-primary dark:bg-primary/18" : "group-hover/tab:bg-muted",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
    </span>
  );
}

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
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-[0_-1px_12px_-6px_rgb(0_0_0/0.12)] md:hidden"
      >
        <ul className="mx-auto flex h-16 max-w-lg items-stretch gap-0.5 px-1.5 py-1">
          {TABS.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(item, active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <TabIcon icon={icon} active={active} />
                  <span className="max-w-full truncate">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openMobile}
              onClick={() => setOpenMobile(true)}
              className={cn(item, !onTab || openMobile ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <TabIcon icon={MenuIcon} active={!onTab || openMobile} />
              <span className="max-w-full truncate">More</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
