"use client";

import { CalendarClockIcon, Loader2Icon, SendIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteScheduleAction, sendScheduleNowAction, setScheduleEnabledAction } from "@/app/(app)/reports/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type ScheduleRow = {
  id: string;
  name: string;
  reportTitle: string;
  cadence: string;
  recipients: string;
  enabled: boolean;
  lastStatus: "sent" | "skipped" | "error" | null;
  lastError: string | null;
  /** Pre-formatted on the server ("27 Sep, 08:02"), or null. */
  lastRun: string | null;
};

function Status({ row }: { row: ScheduleRow }) {
  if (!row.lastStatus) return <span className="text-muted-foreground">Not sent yet</span>;
  const tone = { sent: "bg-emerald-500", skipped: "bg-muted-foreground/50", error: "bg-red-500" }[row.lastStatus];
  const label = { sent: "Sent", skipped: "Skipped", error: "Failed" }[row.lastStatus];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={row.lastError ?? undefined}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone)} />
      <span className={cn("truncate", row.lastStatus === "error" && "text-destructive")}>
        {label}
        {row.lastRun ? <span className="text-muted-foreground tabular-nums"> · {row.lastRun}</span> : null}
      </span>
    </span>
  );
}

export function SchedulesList({ rows }: { rows: ScheduleRow[] }) {
  const [confirm, setConfirm] = useState<ScheduleRow | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const act = (id: string, fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusyId(id);
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.message ?? "Something went wrong");
      setBusyId(null);
    });
  };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <CalendarClockIcon className="size-4" strokeWidth={1.75} />
        </span>
        <p className="text-sm font-medium">No scheduled reports yet</p>
        <p className="max-w-sm text-[13px] leading-5 text-pretty text-muted-foreground">Choose Schedule on any report above to email it to your team every week or month, with the PDF attached.</p>
      </div>
    );
  }

  return (
    <>
      <ul role="list" className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {rows.map((r) => {
          const busy = pending && busyId === r.id;
          return (
            <li key={r.id} className={cn("grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", !r.enabled && "bg-muted/30")}>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  {!r.enabled ? <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">Paused</span> : null}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {r.reportTitle} · {r.cadence} · {r.recipients}
                </p>
                <p className="mt-1 text-xs">
                  <Status row={r} />
                </p>
                {r.lastStatus === "error" && r.lastError ? <p className="mt-1 text-xs text-pretty text-destructive">{r.lastError}</p> : null}
              </div>
              <div className="flex items-center gap-1.5 sm:justify-end">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act(r.id, () => sendScheduleNowAction(r.id))} className="h-10 sm:h-8">
                  {busy ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SendIcon aria-hidden />}
                  {busy ? "Sending…" : "Send now"}
                </Button>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted sm:h-8">
                  <Switch checked={r.enabled} disabled={busy} onCheckedChange={(v) => act(r.id, () => setScheduleEnabledAction(r.id, v))} aria-label={r.enabled ? `Pause ${r.name}` : `Resume ${r.name}`} />
                  <span className="hidden sm:inline">{r.enabled ? "On" : "Off"}</span>
                </label>
                <Button type="button" variant="ghost" size="icon" onClick={() => setConfirm(r)} aria-label={`Delete ${r.name}`} className="size-10 text-muted-foreground hover:text-destructive sm:size-8">
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-balance">Delete “{confirm?.name}”?</DialogTitle>
            <DialogDescription>No more reports go out on this schedule. Reports already sent stay in the export log.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const target = confirm;
                setConfirm(null);
                if (target) act(target.id, () => deleteScheduleAction(target.id));
              }}
            >
              Delete schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
