import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Sticky page title bar. On phones the sidebar toggle is dropped (the bottom tab bar's "More"
 * opens navigation) so the title and a compact control, e.g. the report filters, share one row.
 */
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <header
      data-slot="page-header"
      className="sticky top-[env(safe-area-inset-top)] z-20 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/85 px-4 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 md:min-h-16 md:px-6 md:py-3 2xl:px-8"
    >
      <div className="hidden items-center gap-3 md:flex">
        <SidebarTrigger className="-ml-1.5" />
        <Separator orientation="vertical" className="h-5 self-center" />
      </div>
      <div className="min-w-0 flex-1 basis-24">
        <h1 className="truncate text-lg leading-tight font-semibold tracking-tight md:text-xl" title={title}>
          {title}
        </h1>
        {description ? <p className="mt-0.5 hidden truncate text-[13px] text-muted-foreground md:block">{description}</p> : null}
      </div>
      {children ? <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1760px] space-y-4 p-4 sm:space-y-6 md:p-6 2xl:px-8">{children}</div>;
}
