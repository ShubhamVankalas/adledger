"use client";

import { CalendarClockIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateRange } from "@/lib/format";
import { midSentence } from "@/lib/report-kinds/catalog";
import type { ReportMeta } from "@/lib/report-kinds/types";
import { cn } from "@/lib/utils";
import { defaultRangeKey, RANGE_PRESETS, resolveRange, type RangeKey } from "./range";
import { ReportThumbnail } from "./report-thumbnail";
import { ScheduleDialog, type Member } from "./schedule-dialog";

type Props = {
  reports: ReportMeta[];
  /** Latest day with data (presets end here). */
  anchor: string;
  model: string;
  timezone: string;
  canPdf: boolean;
  canSchedule: boolean;
  members: Member[];
  currentUserId: string;
  emailReady: boolean;
  canConfigureEmail: boolean;
};

export function ReportGallery(props: Props) {
  const [scheduling, setScheduling] = useState<ReportMeta | null>(null);
  return (
    <>
      <ul role="list" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {props.reports.map((r) => (
          <li key={r.id} className="min-w-0">
            <ReportCard meta={r} {...props} onSchedule={() => setScheduling(r)} />
          </li>
        ))}
      </ul>
      {props.canSchedule ? (
        <ScheduleDialog
          report={scheduling}
          onOpenChange={(open) => !open && setScheduling(null)}
          model={props.model}
          timezone={props.timezone}
          members={props.members}
          currentUserId={props.currentUserId}
          emailReady={props.emailReady}
          canConfigureEmail={props.canConfigureEmail}
        />
      ) : null}
    </>
  );
}

const filenameFrom = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

function ReportCard({ meta, anchor, model, canPdf, canSchedule, onSchedule }: Props & { meta: ReportMeta; onSchedule: () => void }) {
  const id = useId();
  const [range, setRange] = useState<RangeKey>(defaultRangeKey(meta.defaultDays));
  const initial = resolveRange(defaultRangeKey(meta.defaultDays), anchor);
  const [custom, setCustom] = useState({ from: initial.start, to: initial.end });
  const [busy, setBusy] = useState(false);
  const customInvalid = range === "custom" && (!custom.from || !custom.to || custom.from > custom.to);
  const period = resolveRange(range, anchor, custom);

  const download = async () => {
    if (customInvalid || busy) return;
    setBusy(true);
    const q = new URLSearchParams({ start: period.start, end: period.end, model: meta.usesModel ? model : "linear", compare: meta.usesCompare ? "previous" : "none" });
    try {
      const res = await fetch(`/api/v1/reports/${meta.id}/pdf?${q}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { hint?: string } | null;
        toast.error(res.status === 429 ? "Other reports are rendering. Try again in a few seconds." : (body?.hint ?? "Couldn’t create that PDF. Try again."));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res, `adledger-${meta.id}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(`${meta.title} downloaded`, { description: dateRange(period.start, period.end, { year: true }) });
    } catch {
      toast.error("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article aria-labelledby={`${id}-title`} className="group/report flex h-full flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/15">
      <ReportThumbnail kind={meta.id} orientation={meta.orientation} className="border-b border-foreground/[0.06]" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={`${id}-title`} className="text-[15px] leading-6 font-semibold tracking-[-0.01em] text-balance">
              {meta.title}
            </h3>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {meta.length}
              {meta.orientation === "landscape" ? " · landscape" : ""}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-pretty text-muted-foreground">{meta.description}</p>
          <p className="mt-2 text-xs text-muted-foreground/90">
            For {midSentence(meta.audience)}
            {!meta.usesModel ? " · all attribution models" : ""}
          </p>
        </div>

        {canPdf || canSchedule ? (
          <div className="mt-auto grid gap-2.5 border-t border-foreground/[0.06] pt-3">
            {canPdf ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-range`} className="sr-only">
                  Period for {meta.title}
                </Label>
                <NativeSelect id={`${id}-range`} value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="[&>select]:h-10 sm:[&>select]:h-9">
                  {Object.entries(RANGE_PRESETS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
                {range === "custom" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
                        From
                      </Label>
                      <Input id={`${id}-from`} type="date" name="from" autoComplete="off" value={custom.from} max={custom.to || undefined} aria-invalid={customInvalid || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 sm:h-9" />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
                        To
                      </Label>
                      <Input id={`${id}-to`} type="date" name="to" autoComplete="off" value={custom.to} min={custom.from || undefined} aria-invalid={customInvalid || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 sm:h-9" />
                    </div>
                    {customInvalid ? (
                      <p role="alert" className="col-span-2 text-xs text-destructive">
                        Pick a start date on or before the end date.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                    {dateRange(period.start, period.end, { year: true })}
                  </p>
                )}
              </div>
            ) : null}
            <div className={cn("grid gap-2", canPdf && canSchedule ? "grid-cols-[1fr_auto]" : "grid-cols-1")}>
              {canPdf ? (
                <Button type="button" onClick={download} disabled={busy || customInvalid} aria-busy={busy || undefined} className="h-10 sm:h-9">
                  {busy ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <DownloadIcon aria-hidden />}
                  {busy ? "Preparing PDF…" : "Download PDF"}
                </Button>
              ) : null}
              {canSchedule ? (
                <Button type="button" variant="outline" onClick={onSchedule} className="h-10 sm:h-9" aria-label={`Schedule ${meta.title}`}>
                  <CalendarClockIcon aria-hidden />
                  Schedule
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
