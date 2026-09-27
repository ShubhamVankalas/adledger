import { ArrowLeftIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

/** Placeholder for a page that lands in a later update: icon, one headline, one line, a way back. */
export function ComingSoon({ title, icon: Icon, headline, body }: { title: string; icon: LucideIcon; headline: string; body: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <section className="flex min-h-[calc(100svh-14rem)] flex-col items-center justify-center px-4 py-16 text-center">
          <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-surface text-muted-foreground shadow-sm">
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="text-title-sm">{headline}</h2>
          <p className="mt-1.5 max-w-sm text-body text-muted-foreground">{body}</p>
          <div className="mt-6 flex items-center gap-3">
            <Button render={<Link href="/" />}>
              <ArrowLeftIcon aria-hidden /> Back to Overview
            </Button>
            <span className="hidden items-center gap-1 text-caption text-fg-faint sm:inline-flex">
              or press{" "}
              <kbd translate="no" className="kbd">
                G
              </kbd>
              <kbd translate="no" className="kbd">
                O
              </kbd>
            </span>
          </div>
        </section>
      </PageBody>
    </>
  );
}
