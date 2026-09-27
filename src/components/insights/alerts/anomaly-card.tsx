"use client";

import { ActivityIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { saveAnomalyRuleAction } from "@/app/actions/alerts";
import { useFormAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ANOMALY_LOOKBACK_DAYS, ANOMALY_SENSITIVITY } from "@/lib/alerts-meta";
import { Segmented } from "../segmented";
import type { ChannelOption } from "./types";

/** The built-in anomaly rule: flags a day far outside the last four weeks on revenue, spend or leads. */
export function AnomalyCard({
  enabled: initialEnabled,
  z,
  channels,
  selected,
}: {
  enabled: boolean;
  z: number;
  channels: ChannelOption[];
  selected: string[];
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [dirty, setDirty] = useState(false);
  const save = useFormAction(saveAnomalyRuleAction, (r) => r.ok && setDirty(false));
  const sensitivity = ANOMALY_SENSITIVITY.some((s) => s.z === z) ? String(z) : "3";

  return (
    <form action={save.submit} onChange={() => setDirty(true)} className="rounded-xl bg-card shadow-(--elev-card)">
      <input type="hidden" name="enabled" value={enabled ? "on" : "off"} />
      <div className="flex items-start gap-3 px-4 pt-4 md:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-foreground">
          <ActivityIcon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="anomaly-title" className="text-title-sm">
            Unusual days
          </h3>
          <p className="text-ui text-pretty text-muted-foreground">
            Flags a day when revenue, ad spend or leads land far outside the previous {ANOMALY_LOOKBACK_DAYS} days. No thresholds to set.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            setDirty(true);
          }}
          aria-labelledby="anomaly-title"
          className="mt-1"
        />
      </div>
      <div className="grid gap-4 px-4 pt-4 pb-4 md:px-5 @2xl/settings:grid-cols-[auto_minmax(0,1fr)] @2xl/settings:gap-8" aria-disabled={!enabled}>
        <div className="grid content-start gap-2">
          <span className="text-caption font-medium">Sensitivity</span>
          <Segmented
            name="sensitivity"
            label="Sensitivity"
            defaultValue={sensitivity}
            options={ANOMALY_SENSITIVITY.map((s) => ({ value: String(s.z), label: s.label, title: s.description }))}
          />
          <span className="text-caption text-muted-foreground">Medium flags clear outliers only.</span>
        </div>
        <div className="grid content-start gap-2">
          <span className="text-caption font-medium">Send to</span>
          {channels.length ? (
            <div className="flex flex-wrap gap-2">
              {channels.map((c) => (
                <label
                  key={c.provider}
                  className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 text-ui transition-[border-color,background-color] duration-100 select-none hover:border-border-strong has-checked:border-brand/50 has-checked:bg-brand-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring pointer-coarse:h-10"
                >
                  <input type="checkbox" name="channels" value={c.provider} defaultChecked={selected.includes(c.provider)} className="size-3.5 accent-[var(--brand)]" />
                  {c.name}
                </label>
              ))}
            </div>
          ) : (
            <span className="text-caption text-muted-foreground">Shown in Insights. Connect a channel in Notifications to be told as well.</span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t px-4 py-3 md:px-5">
        {dirty ? <span className="text-caption text-muted-foreground">Unsaved changes</span> : null}
        <Button type="submit" variant={dirty ? "default" : "outline"} disabled={save.pending} className="max-sm:h-10">
          {save.pending ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
          {save.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
