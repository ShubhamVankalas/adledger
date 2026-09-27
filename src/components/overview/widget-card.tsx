import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Shared anatomy of a card widget: a compact header (title, one-line description, an action on
// the right) over a body that fills the fixed-height frame. Loading, empty, error and data states
// all render inside this, so the card never changes size.

export function WidgetCard({
  title,
  description,
  action,
  children,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-[3.25rem] items-start gap-3 px-4 pt-3.5 md:px-5 md:pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm leading-5 font-semibold tracking-[-0.006em]">{title}</h3>
          {description ? <p className="truncate text-xs leading-4 text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      <div className={cn("min-h-0 flex-1 px-4 pt-3 pb-4 md:px-5", bodyClassName)}>{children}</div>
    </div>
  );
}

/** "All campaigns →" style link in a card header. */
export function CardLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="-mr-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-9"
    >
      {children}
      <ArrowRightIcon aria-hidden className="size-3.5" />
    </Link>
  );
}

/** Empty or not-yet-connected state inside a card: icon, one headline, one line of why, an action. */
export function WidgetEmpty({ icon: Icon, title, children, action }: { icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
      {Icon ? <Icon aria-hidden className="mb-1 size-5 text-muted-foreground/60" /> : null}
      <p className="text-[13px] font-medium">{title}</p>
      {children ? <p className="max-w-xs text-xs text-pretty text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A row in a card list: name on the left, numbers on the right, hairline between rows. */
export const LIST_ROW =
  "-mx-2 grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60";
