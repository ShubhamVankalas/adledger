import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Card anatomy for the Live page: a compact header (title, one line of context, an action) over a
// body. Flat on the canvas with a hairline, 12px radius (BRIEF §2.3).

export function LiveCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  headingId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headingId?: string;
}) {
  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col rounded-xl bg-card text-card-foreground shadow-(--elev-card)", className)}>
      <div className="flex min-h-13 flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-3.5 md:px-5 md:pt-4">
        <div className="min-w-0 flex-1 basis-40">
          <h2 id={headingId} className="truncate text-body leading-5 font-semibold tracking-[-0.006em]">
            {title}
          </h2>
          {description ? <p className="truncate text-caption text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1 max-sm:w-full">{action}</div> : null}
      </div>
      <div className={cn("min-h-0 flex-1 px-2 pt-2 pb-3 md:px-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Empty state inside a card: icon, one headline, one line of why, an optional action. */
export function LiveCardEmpty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 px-6 py-6 text-center">
      <Icon aria-hidden className="mb-1.5 size-5 text-fg-faint" strokeWidth={1.75} />
      <p className="text-ui font-medium">{title}</p>
      {children ? <p className="max-w-xs text-caption text-pretty text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
