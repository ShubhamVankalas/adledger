"use client";

import { CalendarIcon, SlidersHorizontalIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const RANGES = { "7d": "Last 7 days", "14d": "Last 14 days", "30d": "Last 30 days", "90d": "Last 90 days", "180d": "Last 180 days", custom: "Custom range" };
const SHORT_RANGES: Record<string, string> = { "7d": "7 days", "14d": "14 days", "30d": "30 days", "90d": "90 days", "180d": "180 days", custom: "Custom" };
const MODELS = { linear: "Linear", first_touch: "First touch", last_touch: "Last touch" };
const MODEL_HINTS: Record<string, string> = {
  linear: "Credit split evenly across every tracked touch",
  first_touch: "All credit to the ad that first brought them in",
  last_touch: "All credit to the last ad before they converted",
};
const PLATFORMS = {
  all: "All platforms",
  meta: "Meta",
  google: "Google Ads",
  microsoft: "Microsoft Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  reddit: "Reddit",
  x: "X",
  other: "Other / imported",
};

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Props = {
  start: string;
  end: string;
  range: string;
  model: string;
  platform?: string;
  showPlatform?: boolean;
  showModel?: boolean;
};

/**
 * Date range, ad platform and attribution model pickers for report pages.
 * Inline controls from the md breakpoint up; on phones a single "Filters" button that
 * summarises the current choice and opens a bottom sheet.
 */
export function ReportControls(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
      <InlineControls {...props} update={update} />
      <MobileFilters {...props} update={update} />
    </div>
  );
}

type Update = { update: (patch: Record<string, string | null>) => void };

function InlineControls({ start, end, range, model, platform, showPlatform = true, showModel = true, update }: Props & Update) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  return (
    <div className="hidden flex-wrap items-center gap-2 md:flex">
      <Select
        items={RANGES}
        value={range}
        onValueChange={(v) => {
          if (v === "custom") setCustomOpen(true);
          else update({ range: String(v), from: null, to: null });
        }}
      >
        <SelectTrigger className="min-w-36" aria-label="Date range">
          <CalendarIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(RANGES).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {range === "custom" || customOpen ? (
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger render={<Button variant="outline" className="tabular" />}>
            {fmt(from)} – {fmt(to)}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (from && to && from <= to) {
                  update({ range: "custom", from, to });
                  setCustomOpen(false);
                }
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="from">From</Label>
                <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </div>
              <Button type="submit">Apply</Button>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}

      {showPlatform ? (
        <Select items={PLATFORMS} value={platform ?? "all"} onValueChange={(v) => update({ platform: v === "all" ? null : String(v) })}>
          <SelectTrigger className="min-w-32" aria-label="Ad platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PLATFORMS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {showModel ? (
        <div className="flex h-8 items-center rounded-lg border bg-muted/40 p-0.5 pointer-coarse:h-10" role="radiogroup" aria-label="Attribution model">
          {Object.entries(MODELS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={model === k}
              onClick={() => update({ model: k })}
              className={cn(
                "h-full rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                model === k && "bg-background text-foreground shadow-sm dark:bg-input/60",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MobileFilters({ start, end, range, model, platform, showPlatform = true, showModel = true, update }: Props & Update) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ range, from: start, to: end, platform: platform ?? "all", model });

  const rangeLabel = range === "custom" ? `${fmt(start)} – ${fmt(end)}` : (SHORT_RANGES[range] ?? range);
  const platformActive = showPlatform && !!platform && platform !== "all";
  const summary = [rangeLabel, platformActive ? PLATFORMS[platform as keyof typeof PLATFORMS] : null, showModel ? MODELS[model as keyof typeof MODELS] : null].filter(Boolean).join(" · ");
  const customInvalid = draft.range === "custom" && (!draft.from || !draft.to || draft.from > draft.to);

  const apply = () => {
    if (customInvalid) return;
    const patch: Record<string, string | null> =
      draft.range === "custom" ? { range: "custom", from: draft.from, to: draft.to } : { range: draft.range, from: null, to: null };
    if (showPlatform) patch.platform = draft.platform === "all" ? null : draft.platform;
    if (showModel) patch.model = draft.model;
    update(patch);
    setOpen(false);
  };

  return (
    <div className="md:hidden">
      <Button
        variant="outline"
        className="h-10 max-w-[62vw] gap-2 rounded-full pr-3.5 pl-3 text-[13px]"
        aria-label={`Filters: ${summary}`}
        onClick={() => {
          setDraft({ range, from: start, to: end, platform: platform ?? "all", model });
          setOpen(true);
        }}
      >
        <SlidersHorizontalIcon className="text-muted-foreground" />
        <span className="tabular truncate">{summary}</span>
        {platformActive ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[calc(100svh-env(safe-area-inset-top)-1.5rem)] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetHeader className="pb-2">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Choose the period{showPlatform ? ", ad platform" : ""}{showModel ? " and attribution model" : ""}.</SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 gap-6 overflow-y-auto overscroll-contain px-4 pt-2 pb-5">
            <fieldset className="grid gap-2.5">
              <legend className="mb-2.5 text-sm font-medium">Date range</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Date range">
                {Object.entries(SHORT_RANGES).map(([k, v]) => (
                  <Chip key={k} checked={draft.range === k} onClick={() => setDraft((d) => ({ ...d, range: k }))}>
                    {v}
                  </Chip>
                ))}
              </div>
              {draft.range === "custom" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-from" className="text-xs text-muted-foreground">
                      From
                    </Label>
                    <Input id="m-from" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-to" className="text-xs text-muted-foreground">
                      To
                    </Label>
                    <Input id="m-to" type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
                  </div>
                  {customInvalid ? <p className="col-span-2 text-xs text-destructive">Pick a start date on or before the end date.</p> : null}
                </div>
              ) : null}
            </fieldset>

            {showPlatform ? (
              <div className="grid gap-2.5">
                <Label htmlFor="m-platform">Ad platform</Label>
                <NativeSelect id="m-platform" value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))} className="[&>select]:h-11">
                  {Object.entries(PLATFORMS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {showModel ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2.5 text-sm font-medium">Attribution model</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Attribution model">
                  {Object.entries(MODELS).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={draft.model === k}
                      onClick={() => setDraft((d) => ({ ...d, model: k }))}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        draft.model === k ? "border-primary/60 bg-primary/8" : "hover:bg-muted",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          draft.model === k ? "border-primary" : "border-muted-foreground/40",
                        )}
                      >
                        {draft.model === k ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{v}</span>
                        <span className="text-xs text-muted-foreground">{MODEL_HINTS[k]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>

          <SheetFooter className="mt-0 grid grid-cols-[auto_1fr] gap-2 border-t bg-popover">
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => setDraft({ range: "30d", from: start, to: end, platform: "all", model: "linear" })}
            >
              Reset
            </Button>
            <Button className="h-11" disabled={customInvalid} onClick={apply}>
              Show results
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Chip({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "h-10 rounded-lg border text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
