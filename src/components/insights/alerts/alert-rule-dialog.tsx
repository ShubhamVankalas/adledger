"use client";

import { BellRingIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { previewAlertRuleAction, saveAlertRuleAction } from "@/app/actions/alerts";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ALERT_METRICS, COOLDOWN_HOUR_OPTIONS, WINDOW_DAY_OPTIONS, metricDef } from "@/lib/alerts-meta";
import { cn } from "@/lib/utils";
import { Segmented } from "../segmented";
import type { CampaignOption, ChannelOption, PlatformOption, RuleDraft, RuleView } from "./types";

const WINDOW_LABEL: Record<number, string> = { 1: "Yesterday", 2: "Last 2 days", 3: "Last 3 days", 7: "Last 7 days", 14: "Last 14 days", 30: "Last 30 days" };
const COOLDOWN_LABEL: Record<number, string> = { 6: "Every 6 hours", 12: "Every 12 hours", 24: "Once a day", 48: "Every 2 days", 168: "Once a week" };

type Preview = { value: string; measurable: boolean; breached: boolean; window: string; rule: string } | { error: string } | null;

const LABEL = "text-caption font-medium text-foreground";

/** Create or edit a threshold alert. Shows what the metric is right now, so the threshold is easy to pick. */
export function AlertRuleDialog({
  open,
  onOpenChange,
  rule,
  draft,
  currencySymbol,
  channels,
  platforms,
  campaigns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rule being edited, or null to create one. */
  rule: RuleView | null;
  /** Prefill for a new rule (from a suggestion). */
  draft?: RuleDraft | null;
  currencySymbol: string;
  channels: ChannelOption[];
  platforms: PlatformOption[];
  campaigns: CampaignOption[];
}) {
  const base = rule ?? draft ?? {};
  const [metric, setMetric] = useState(base.metric ?? "cac");
  const [comparator, setComparator] = useState<"gt" | "lt">(base.comparator ?? (base.metric === "roas" || base.metric === "revenue" || base.metric === "leads" ? "lt" : "gt"));
  const [scope, setScope] = useState<"workspace" | "platform" | "campaign">(base.scope ?? "workspace");
  const [preview, setPreview] = useState<Preview>(null);
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const id = useId();
  const unit = metricDef(metric).unit;

  const runPreview = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = form.current;
      if (!el) return;
      const data = new FormData(el);
      if (!String(data.get("threshold") ?? "").trim()) return setPreview(null);
      startPreview(async () => {
        const r = await previewAlertRuleAction(data);
        setPreview(r.ok ? (r.data as Preview) : { error: r.message ?? "Couldn’t check this rule." });
      });
    }, 450);
  };

  // Check the current value once when the dialog opens with a complete rule.
  useEffect(() => {
    if (open) runPreview();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (data: FormData) =>
    startSave(async () => {
      const r = await saveAlertRuleAction(data);
      if (!r.ok) {
        toast.error(r.message ?? "Couldn’t save the alert.");
        return;
      }
      toast.success(r.message ?? "Saved");
      onOpenChange(false);
      router.refresh();
    });

  const platformByCampaign = (c: CampaignOption) => platforms.find((p) => p.id === c.platform)?.label ?? c.platform;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit alert" : "New alert"}</DialogTitle>
          <DialogDescription>Checked every hour against complete days. You hear about a breach once, then again only after it recovers.</DialogDescription>
        </DialogHeader>

        <form ref={form} action={submit} onChange={runPreview} className="grid gap-5" aria-describedby={`${id}-preview`}>
          {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

          <div className="grid gap-3">
            <p className={LABEL}>When</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <NativeSelect
                name="metric"
                aria-label="Metric"
                value={metric}
                onChange={(e) => {
                  setMetric(e.target.value);
                  setComparator(e.target.value === "roas" || e.target.value === "revenue" || e.target.value === "leads" ? "lt" : "gt");
                }}
              >
                {ALERT_METRICS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
              <Segmented
                name="comparator"
                label="Condition"
                value={comparator}
                onChange={setComparator}
                options={[
                  { value: "gt", label: "goes above" },
                  { value: "lt", label: "drops below" },
                ]}
                className="max-sm:w-full"
              />
            </div>
            <p className="-mt-1 text-caption text-muted-foreground">{metricDef(metric).description}.</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="sr-only">Threshold</span>
                <span className="relative">
                  {unit === "money" ? (
                    <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ui text-muted-foreground">
                      {currencySymbol}
                    </span>
                  ) : null}
                  <Input
                    name="threshold"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    defaultValue={base.threshold ?? ""}
                    placeholder={unit === "money" ? "80" : unit === "ratio" ? "1.5" : "10"}
                    className={cn("num h-9", unit === "money" && "pl-7", unit === "ratio" && "pr-7")}
                    aria-label={`Threshold${unit === "money" ? ` in ${currencySymbol}` : unit === "ratio" ? " (ROAS, for example 1.5)" : ""}`}
                  />
                  {unit === "ratio" ? (
                    <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ui text-muted-foreground">
                      ×
                    </span>
                  ) : null}
                </span>
              </label>
              <NativeSelect name="windowDays" aria-label="Period" defaultValue={String(base.windowDays ?? 1)}>
                {WINDOW_DAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {WINDOW_LABEL[d]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid gap-3">
            <p className={LABEL}>For</p>
            <Segmented
              name="scope"
              label="Scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: "workspace", label: "Everything" },
                { value: "platform", label: "One platform" },
                { value: "campaign", label: "One campaign" },
              ]}
              className="w-full"
            />
            {scope === "platform" ? (
              <NativeSelect name="platform" aria-label="Platform" defaultValue={base.scope === "platform" ? (base.scopeId ?? platforms[0]?.id) : platforms[0]?.id}>
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {scope === "campaign" ? (
              campaigns.length ? (
                <NativeSelect name="campaign" aria-label="Campaign" defaultValue={base.scope === "campaign" ? (base.scopeId ?? "") : ""}>
                  <option value="" disabled>
                    Choose a campaign…
                  </option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({platformByCampaign(c)})
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <p className="rounded-md bg-fill px-3 py-2 text-caption text-muted-foreground">No campaigns yet. They appear after the first ad sync.</p>
              )
            ) : null}
          </div>

          <div className="grid gap-3">
            <p className={LABEL}>Notify</p>
            {channels.length ? (
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <label
                    key={c.provider}
                    className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 text-ui transition-[border-color,background-color] duration-100 select-none hover:border-border-strong has-checked:border-brand/50 has-checked:bg-brand-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring pointer-coarse:h-10"
                  >
                    <input
                      type="checkbox"
                      name="channels"
                      value={c.provider}
                      defaultChecked={rule ? rule.channels.includes(c.provider) : true}
                      className="size-3.5 accent-[var(--brand)]"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md bg-fill px-3 py-2 text-caption text-muted-foreground">
                No channel is connected yet, so this alert will only show in Insights.{" "}
                <Link href="/settings/workspace/notifications" className="font-medium text-foreground underline underline-offset-2">
                  Connect Slack, email or another channel
                </Link>
                .
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-caption text-muted-foreground">Repeat at most</span>
                <NativeSelect name="cooldownHours" defaultValue={String(rule?.cooldownHours ?? 24)}>
                  {COOLDOWN_HOUR_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {COOLDOWN_LABEL[h]}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1.5">
                <span className="text-caption text-muted-foreground">Name (optional)</span>
                <Input name="name" autoComplete="off" maxLength={80} defaultValue={base.name ?? ""} placeholder="High CAC on Meta…" className="h-9" />
              </label>
            </div>
          </div>

          <div
            id={`${id}-preview`}
            aria-live="polite"
            className={cn(
              "flex min-h-11 items-start gap-2.5 rounded-lg px-3 py-2.5 text-ui transition-colors duration-150",
              preview && "breached" in preview && preview.breached ? "bg-warning-soft" : "bg-fill",
            )}
          >
            {previewing ? (
              <Loader2Icon aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : preview && "breached" in preview && preview.breached ? (
              <BellRingIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            ) : (
              <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <p className="min-w-0 text-pretty">
              {!preview ? (
                <span className="text-muted-foreground">Enter a threshold to see where this metric stands today.</span>
              ) : "error" in preview ? (
                <span className="text-muted-foreground">{preview.error}</span>
              ) : !preview.measurable ? (
                <span className="text-muted-foreground">
                  {metricDef(metric).label} can’t be measured {preview.window} yet (nothing to divide by), so this alert stays quiet.
                </span>
              ) : (
                <>
                  <span className="text-muted-foreground">Right now: </span>
                  <span className="num font-medium">
                    {metricDef(metric).label} is {preview.value}
                  </span>{" "}
                  <span className="text-muted-foreground">{preview.window}.</span>{" "}
                  {preview.breached ? <span className="font-medium">This alert would fire at the next check.</span> : <span className="text-muted-foreground">No alert today.</span>}
                </>
              )}
            </p>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="max-sm:h-10" disabled={saving} />}>Cancel</DialogClose>
            <Button type="submit" className="max-sm:h-10" disabled={saving}>
              {saving ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
              {saving ? "Saving…" : rule ? "Save alert" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
