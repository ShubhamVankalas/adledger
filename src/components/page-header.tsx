import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { DemoPill, HeaderSearchButton, PendingBar } from "@/components/app-shell";
import { HeaderLive } from "@/components/live/live-pulse";
import { SidebarTrigger } from "@/components/ui/sidebar";

type Crumb = { href: string; label: string };

/**
 * Page width and gutters, shared by every page body, the settings shell and the loading skeletons:
 * content grows with the window up to 1920px (centred beyond that), with 16px gutters on phones,
 * 24px from md and 32px from 2xl.
 */
export const PAGE_WIDTH = "mx-auto w-full max-w-[1920px] px-4 md:px-6 2xl:px-8";

/**
 * The 52px sticky bar at the top of every page: sidebar toggle, breadcrumb or title (16/600), the
 * demo pill, then the page's controls (the report filter bar) on the right. The live pill (visitors
 * now and today's revenue, links to Live) is the last item at the top right on every page and
 * shrinks to a dot and a count on phones. A 2px line runs along the bottom edge while a navigation
 * or filter change is pending. On phones the search button sits before the pill and the bottom tab
 * bar replaces the sidebar toggle.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
}: {
  title: string;
  /** One line of context, shown after the title on wide screens (and as the title's tooltip). */
  description?: string;
  /** Parent pages, e.g. [{ href: "/contacts", label: "Contacts" }]. */
  breadcrumbs?: Crumb[];
  children?: React.ReactNode;
}) {
  return (
    <header
      data-slot="page-header"
      className="sticky top-[env(safe-area-inset-top)] z-20 flex min-h-[52px] items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/80 md:gap-3 md:px-6"
    >
      <SidebarTrigger className="-ml-1.5 hidden text-muted-foreground hover:text-foreground md:inline-flex" />
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink items-center gap-1 text-ui text-muted-foreground sm:flex">
            {breadcrumbs.map((c) => (
              <span key={c.href} className="flex min-w-0 items-center gap-1">
                <Link href={c.href} className="truncate rounded-sm transition-colors duration-100 hover:text-foreground">
                  {c.label}
                </Link>
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="min-w-0 shrink-[0.05] truncate text-title-sm" title={description ? `${title}: ${description}` : title}>
          {title}
        </h1>
        {description ? <p className="hidden min-w-0 truncate text-ui text-muted-foreground min-[1800px]:block">{description}</p> : null}
        <DemoPill />
      </div>
      {children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
      <HeaderSearchButton />
      <HeaderLive />
      <Suspense fallback={null}>
        <PendingBar />
      </Suspense>
    </header>
  );
}

/** Page content: fills the window up to 1920px (see PAGE_WIDTH). */
export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className={`${PAGE_WIDTH} space-y-4 pt-4 pb-8 md:space-y-5 md:pt-5 md:pb-12`}>{children}</div>;
}
