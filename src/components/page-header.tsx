import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { DemoPill, HeaderSearchButton, PendingBar } from "@/components/app-shell";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Crumb = { href: string; label: string };

/**
 * The 52px sticky bar at the top of every page: sidebar toggle, breadcrumb or title (16/600), the
 * demo pill, then the page's controls (the report filter bar) on the right. A 2px line runs along
 * the bottom edge while a navigation or filter change is pending. On phones the search button sits
 * at the right edge and the bottom tab bar replaces the sidebar toggle.
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
        <h1 className="min-w-0 truncate text-title-sm" title={description ? `${title}: ${description}` : title}>
          {title}
        </h1>
        {description ? <p className="hidden min-w-0 truncate text-ui text-muted-foreground 2xl:block">{description}</p> : null}
        <DemoPill />
      </div>
      {children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
      <HeaderSearchButton />
      <Suspense fallback={null}>
        <PendingBar />
      </Suspense>
    </header>
  );
}

/**
 * Page content: 1440px max, 24px gutters on desktop and 16px on phones. It arrives with a short
 * fade, soft blur and a few pixels of rise, on route changes and when the real page replaces its
 * loading skeleton (`instant` turns that off, for the skeletons themselves).
 */
export function PageBody({ children, instant }: { children: React.ReactNode; instant?: boolean }) {
  return <div className={cn("mx-auto w-full max-w-[1440px] space-y-4 px-4 pt-4 pb-8 md:space-y-5 md:px-6 md:pt-5 md:pb-12", !instant && "page-arrive")}>{children}</div>;
}
