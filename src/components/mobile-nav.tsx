"use client";

import { AudioWaveformIcon, BarChart3Icon, EllipsisIcon, LayoutGridIcon, UsersIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Overview", icon: LayoutGridIcon },
  { href: "/performance", label: "Performance", icon: BarChart3Icon },
  { href: "/live", label: "Live", icon: AudioWaveformIcon },
  { href: "/contacts", label: "Contacts", icon: UsersIcon },
] as const;

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

const item =
  "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] leading-4 font-medium outline-none transition-[color,background-color] duration-100 ease-out touch-manipulation focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring active:bg-fill-hover";

function Tab({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <Icon className="size-5" strokeWidth={active ? 2 : 1.75} aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </>
  );
}

/**
 * Floating, translucent bottom tab bar for phones (below md, where the sidebar becomes a sheet):
 * Overview · Performance · Live · Contacts · More. It slides away while scrolling down and returns
 * on the way up. "More" opens the sidebar sheet (every other page, workspace switching, account).
 * A spacer keeps the last content on the page clear of the bar.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { openMobile, setOpenMobile } = useSidebar();
  const onTab = TABS.some((t) => isActive(pathname, t.href));
  const nav = useRef<HTMLElement>(null);

  // Close the "More" sheet once a link inside it navigates somewhere.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  // Hide on scroll down, show on scroll up. Writes a data attribute (no React re-render per frame).
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const el = nav.current;
        if (!el) return;
        const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
        if (y < 24 || y < last - 4 || nearBottom) el.dataset.hidden = "false";
        else if (y > last + 4) el.dataset.hidden = "true";
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // A new page starts with the bar visible.
  useEffect(() => {
    if (nav.current) nav.current.dataset.hidden = "false";
  }, [pathname]);

  return (
    <>
      <div aria-hidden className="h-[calc(5rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
      <nav
        ref={nav}
        aria-label="Primary"
        data-slot="mobile-nav"
        data-hidden="false"
        className={cn(
          "fixed inset-x-3 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl p-1 md:hidden",
          "bg-surface/85 shadow-lg backdrop-blur-xl backdrop-saturate-150 supports-[not(backdrop-filter:blur(1px))]:bg-surface",
          "transition-[translate,opacity] duration-(--dur-slow) ease-out data-[hidden=true]:pointer-events-none data-[hidden=true]:translate-y-[calc(100%+1.5rem)] data-[hidden=true]:opacity-0",
        )}
      >
        <ul className="flex h-[52px] items-stretch gap-0.5">
          {TABS.map(({ href, label, icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex min-w-0 flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(item, active ? "bg-fill-active text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Tab icon={icon} label={label} active={active} />
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
              className={cn(item, !onTab || openMobile ? "bg-fill-active text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Tab icon={EllipsisIcon} label="More" active={!onTab || openMobile} />
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
