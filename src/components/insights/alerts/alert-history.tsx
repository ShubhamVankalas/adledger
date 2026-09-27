import { ActivityIcon, BellRingIcon, CheckIcon, HistoryIcon } from "lucide-react";
import { dateRange, longDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export type HistoryItem = {
  id: string;
  kind: "threshold" | "anomaly";
  status: "triggered" | "resolved";
  title: string;
  detail: string;
  periodStart: string;
  periodEnd: string;
  delivered: string[];
  createdAt: string;
};

/** Alert history: what fired, what recovered and where it was sent. Newest first. */
export function AlertHistory({ items, channelNames, emptyHint }: { items: HistoryItem[]; channelNames: Record<string, string>; emptyHint?: string }) {
  if (!items.length) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-card px-4 py-4 shadow-(--elev-card) md:px-5">
        <HistoryIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-ui font-medium">Nothing has fired yet</p>
          <p className="text-ui text-pretty text-muted-foreground">{emptyHint ?? "When an alert triggers or recovers, it shows up here with where it was sent."}</p>
        </div>
      </div>
    );
  }
  return (
    <ol className="overflow-hidden rounded-xl bg-card px-4 py-1 shadow-(--elev-card) md:px-5">
      {items.map((e) => {
        const Icon = e.status === "resolved" ? CheckIcon : e.kind === "anomaly" ? ActivityIcon : BellRingIcon;
        return (
          <li key={e.id} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 py-3 [&+li]:border-t">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full",
                e.status === "resolved" ? "bg-fill text-muted-foreground" : e.kind === "anomaly" ? "bg-brand-soft text-brand-foreground" : "bg-warning-soft text-warning-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="min-w-0 text-ui font-medium text-pretty">{e.title}</p>
                <time dateTime={e.createdAt} className="shrink-0 text-caption text-muted-foreground" suppressHydrationWarning title={new Date(e.createdAt).toISOString()}>
                  {timeAgo(e.createdAt)}
                </time>
              </div>
              {e.detail ? <p className="text-caption text-pretty text-muted-foreground">{e.detail}</p> : null}
              <p className="mt-0.5 text-caption text-muted-foreground">
                {e.periodStart === e.periodEnd ? longDate(e.periodEnd) : dateRange(e.periodStart, e.periodEnd, { year: true })}
                {e.status === "triggered" ? (
                  <>
                    <span aria-hidden> · </span>
                    {e.delivered.length ? `Sent to ${e.delivered.map((d) => channelNames[d] ?? d.replace(/^notify_/, "")).join(", ")}` : "Not sent anywhere"}
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
