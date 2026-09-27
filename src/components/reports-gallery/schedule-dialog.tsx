"use client";

import { Loader2Icon, MailWarningIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { createScheduleAction } from "@/app/(app)/reports/actions";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MODEL_LABELS } from "@/lib/format";
import { midSentence } from "@/lib/report-kinds/catalog";
import type { ReportMeta } from "@/lib/report-kinds/types";
import { cn } from "@/lib/utils";

export type Member = { id: string; name: string | null; email: string };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid h-10 grid-cols-2 gap-0.5 rounded-[7px] bg-fill p-0.5 sm:h-8">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              const i = options.findIndex((x) => x.value === value);
              const j = (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
              onChange(options[j].value);
              (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
            }
          }}
          className={cn(
            "rounded-[5px] text-ui font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ease-out outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            value === o.value && "bg-surface text-foreground shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type DialogProps = {
  report: ReportMeta | null;
  onOpenChange: (open: boolean) => void;
  model: string;
  timezone: string;
  members: Member[];
  currentUserId: string;
  emailReady: boolean;
  canConfigureEmail: boolean;
};

export function ScheduleDialog(props: DialogProps) {
  return (
    <Dialog open={props.report !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by report: a fresh form (and defaults) every time a report is chosen. */}
        {props.report ? <ScheduleForm key={props.report.id} {...props} report={props.report} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({ report, onOpenChange, model, timezone, members, currentUserId, emailReady, canConfigureEmail }: DialogProps & { report: ReportMeta }) {
  const id = useId();
  const [pending, start] = useTransition();
  // Short-range reports default to weekly, month-sized ones to monthly.
  const [cadence, setCadence] = useState<"weekly" | "monthly">(report.defaultDays <= 7 ? "weekly" : "monthly");
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(8);
  const [name, setName] = useState("");
  const [who, setWho] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<string[]>([currentUserId]);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (who === "some" && picked.length === 0) {
      setError("Choose at least one person.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await createScheduleAction({
        kind: report.id,
        name: name.trim() || undefined,
        cadence,
        weekday,
        hour,
        model: report.usesModel ? (model as "linear") : "linear",
        recipients: who,
        userIds: who === "some" ? picked : [],
        skipEmpty,
      });
      if (r.ok) {
        toast.success(r.message ?? "Scheduled");
        onOpenChange(false);
      } else {
        setError(r.message ?? "Couldn’t save the schedule.");
      }
    });
  };

  const placeholder = `${report.title}, ${cadence}`;

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader className="pr-8">
        <DialogTitle className="text-balance">Schedule {midSentence(report.title)}</DialogTitle>
        <DialogDescription>The PDF is emailed to the people you choose{report.usesModel ? `, using ${MODEL_LABELS[model]?.toLowerCase() ?? "linear"} attribution` : ""}.</DialogDescription>
      </DialogHeader>

      {!emailReady ? (
        <div role="note" className="flex gap-2.5 rounded-lg bg-warning-soft p-3 text-ui text-foreground">
          <MailWarningIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
          <p>
            Email isn’t set up for this workspace yet, so scheduled reports can’t be delivered.{" "}
            {canConfigureEmail ? (
              <Link href="/settings/workspace/notifications" className="font-medium underline underline-offset-2">
                Set up email
              </Link>
            ) : (
              "Ask an admin to set up email in Settings."
            )}
          </p>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input id={`${id}-name`} name="name" autoComplete="off" maxLength={80} placeholder={`${placeholder}…`} value={name} onChange={(e) => setName(e.target.value)} className="h-10 sm:h-9" />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">How often</legend>
        <Segmented
          label="How often"
          value={cadence}
          onChange={setCadence}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          {cadence === "weekly" ? (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-day`} className="text-xs text-muted-foreground">
                Day
              </Label>
              <NativeSelect id={`${id}-day`} name="weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Day</span>
              <p className="flex h-10 items-center text-sm md:h-9">1st of the month</p>
            </div>
          )}
          <div className="grid gap-1">
            <Label htmlFor={`${id}-hour`} className="text-xs text-muted-foreground">
              Time
            </Label>
            <NativeSelect id={`${id}-hour`} name="hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {HOURS.map((h, i) => (
                <option key={h} value={i}>
                  {h}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {cadence === "weekly" ? "Covers the 7 days before each send" : "Covers the previous calendar month"}, in {timezone}.
        </p>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Send to</legend>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
          <input type="radio" name={`${id}-who`} value="all" checked={who === "all"} onChange={() => setWho("all")} className="size-4 accent-foreground" />
          Everyone with PDF access
          <span className="text-muted-foreground tabular-nums">({members.length})</span>
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
          <input type="radio" name={`${id}-who`} value="some" checked={who === "some"} onChange={() => setWho("some")} className="size-4 accent-foreground" />
          Only the people I choose
        </label>
        {who === "some" ? (
          <ul role="list" className="max-h-44 divide-y overflow-y-auto overscroll-contain rounded-lg ring-1 ring-foreground/10">
            {members.map((m) => (
              <li key={m.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={picked.includes(m.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))}
                    className="size-4 shrink-0 accent-foreground"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{m.name || m.email}</span>
                    {m.name ? <span className="block truncate text-xs text-muted-foreground">{m.email}</span> : null}
                  </span>
                  {m.id === currentUserId ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">You</span> : null}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Skip quiet periods</span>
          <span className="text-xs text-muted-foreground">Don’t send when there was no ad spend and no revenue.</span>
        </span>
        <Switch checked={skipEmpty} onCheckedChange={setSkipEmpty} className="mt-1" aria-label="Skip quiet periods" />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" className="h-10 sm:h-9" />}>Cancel</DialogClose>
        <Button type="submit" disabled={pending} className="h-10 sm:h-9">
          {pending ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Saving…" : "Create schedule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
