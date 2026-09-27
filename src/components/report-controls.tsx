"use client";

import { CalendarIcon, CheckIcon, ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { DateRange } from "react-day-picker";
import { navProgress } from "@/components/app-shell";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { dateRange, shortDate } from "@/lib/format";
import {
  COMPARE_MODES,
  DEFAULT_COMPARE,
  DEFAULT_RANGE,
  parseCompare,
  RANGE_PRESETS,
  rangeLabel,
  rangeShort,
  type CompareMode,
} from "@/lib/period-presets";
import { cn } from "@/lib/utils";

// Brief order: Last / First / Linear.
const MODELS = { last_touch: "Last", first_touch: "First", linear: "Linear" } as const;
const MODEL_NAMES: Record<string, string> = { last_touch: "Last touch", first_touch: "First touch", linear: "Linear" };
const MODEL_HINTS: Record<string, string> = {
  last_touch: "All credit to the last ad before they converted",
  first_touch: "All credit to the ad that first brought them in",
  linear: "Credit split evenly across every tracked touch",
};
const COMPARE_SHORT: Record<CompareMode, string> = { prev: "vs prev", year: "vs last year", none: "no compare" };
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

/** Arrow keys move between (and select) the options of a role="radiogroup", like native radio buttons. */
function onRadioKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const radios = Array.from(e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  const i = radios.indexOf(e.currentTarget);
  if (i === -1) return;
  e.preventDefault();
  const next = radios[(i + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

const toDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Props = {
  start: string;
  end: string;
  range: string;
  model: string;
  platform?: string;
  /** Comparison mode (prev, year, none). Defaults to the URL's ?compare=, then "prev". */
  compare?: string;
  showPlatform?: boolean;
  showModel?: boolean;
  showCompare?: boolean;
};

type Update = (patch: Record<string, string | null>) => void;

/**
 * The report filter bar, in the brief's order: date range · compare · platform · model. Every
 * choice lives in the URL (range/from/to, compare, platform, model), so any view is a link.
 * Inline from 1280px; below that one summary button ("Last 30 days · vs prev · Linear") opens a
 * drawer (bottom sheet on phones, side sheet on tablets). Old data stays on screen, dimmed, while
 * the next view loads.
 */
export function ReportControls(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const compare = parseCompare(props.compare ?? sp.get("compare"));

  useEffect(() => {
    if (pending) navProgress.start("filters");
    else navProgress.done("filters");
  }, [pending]);
  useEffect(() => () => navProgress.done("filters"), []);

  const update: Update = (patch) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const shared = { ...props, compare, update };
  return (
    <div className={cn("transition-opacity duration-150", pending && "opacity-60")} aria-busy={pending || undefined}>
      <InlineControls {...shared} />
      <CompactControls {...shared} />
    </div>
  );
}

type Inner = Omit<Props, "compare"> & { compare: CompareMode; update: Update };

function InlineControls({ start, end, range, model, platform, compare, showPlatform = true, showModel = true, showCompare = true, update }: Inner) {
  return (
    <div className="hidden items-center gap-1.5 xl:flex">
      <DatePicker start={start} end={end} range={range} update={update} />
      {showCompare ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="font-normal" aria-label={`Compare: ${COMPARE_MODES.find((c) => c.key === compare)?.label}`} />}>
            <span className={cn(compare === "none" && "text-muted-foreground")}>{COMPARE_MODES.find((c) => c.key === compare)?.short}</span>
            <ChevronDownIcon aria-hidden className="size-3.5 text-fg-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Compare to</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={compare} onValueChange={(v) => update({ compare: v === DEFAULT_COMPARE ? null : String(v) })}>
                {COMPARE_MODES.map((c) => (
                  <DropdownMenuRadioItem key={c.key} value={c.key}>
                    {c.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {showPlatform ? (
        <Select items={PLATFORMS} value={platform ?? "all"} onValueChange={(v) => update({ platform: v === "all" ? null : String(v) })}>
          <SelectTrigger size="sm" className="min-w-32" aria-label="Ad platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {Object.entries(PLATFORMS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {showModel ? (
        <div className="flex h-7 items-center rounded-[7px] bg-fill p-0.5" role="radiogroup" aria-label="Attribution model">
          {Object.entries(MODELS).map(([k, v]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={model === k}
              aria-label={MODEL_NAMES[k]}
              title={MODEL_HINTS[k]}
              tabIndex={model === k ? 0 : -1}
              onClick={() => model !== k && update({ model: k })}
              onKeyDown={onRadioKeyDown}
              className={cn(
                "h-full rounded-[5px] px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ease-out outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                model === k && "bg-surface text-foreground shadow-sm",
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

/** Date range button: presets on the left, a two-month range calendar for custom dates on the right. */
function DatePicker({ start, end, range, update }: { start: string; end: string; range: string; update: Update }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<DateRange | undefined>();
  const selection = sel ?? { from: toDate(start), to: toDate(end) };
  const canApply = !!sel?.from && !!sel?.to;
  const label = range === "custom" ? dateRange(start, end) : rangeLabel(range);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setSel(undefined);
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="font-normal" aria-label={`Date range: ${label}, ${dateRange(start, end)}`} />}>
        <CalendarIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="num">{label}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 text-fg-faint" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto flex-row gap-0 p-0">
        <div role="listbox" aria-label="Date presets" className="flex w-40 flex-col gap-px border-r p-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="option"
              aria-selected={range === p.key}
              onClick={() => {
                update({ range: p.key, from: null, to: null });
                setOpen(false);
              }}
              className="flex h-7.5 items-center justify-between rounded-md px-2 text-left text-ui outline-none hover:bg-fill-hover focus-visible:bg-fill-hover aria-selected:font-medium"
            >
              {p.label}
              {range === p.key ? <CheckIcon aria-hidden className="size-3.5" /> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-col">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={new Date(toDate(end).getFullYear(), toDate(end).getMonth() - 1, 1)}
            selected={selection}
            onSelect={setSel}
            disabled={{ after: new Date() }}
            className="p-3"
          />
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2.5">
            <span className="num text-caption text-muted-foreground">
              {selection.from ? shortDate(toIso(selection.from)) : "Start"} – {selection.to ? shortDate(toIso(selection.to)) : "end"}
            </span>
            <Button
              size="sm"
              disabled={!canApply}
              onClick={() => {
                if (!sel?.from || !sel.to) return;
                update({ range: "custom", from: toIso(sel.from), to: toIso(sel.to) });
                setOpen(false);
              }}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CompactControls({ start, end, range, model, platform, compare, showPlatform = true, showModel = true, showCompare = true, update }: Inner) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const initial = { range, from: start, to: end, platform: platform ?? "all", model, compare };
  const [draft, setDraft] = useState(initial);

  const rangeText = range === "custom" ? dateRange(start, end) : rangeLabel(range);
  const rangeTextShort = range === "custom" ? `${shortDate(start)} – ${shortDate(end)}` : rangeShort(range);
  const platformActive = showPlatform && !!platform && platform !== "all";
  const tail = [
    showCompare ? COMPARE_SHORT[compare] : null,
    platformActive ? PLATFORMS[platform as keyof typeof PLATFORMS] : null,
    showModel ? MODELS[model as keyof typeof MODELS] : null,
  ].filter(Boolean);
  const ariaTail = [
    showCompare ? COMPARE_SHORT[compare] : null,
    platformActive ? PLATFORMS[platform as keyof typeof PLATFORMS] : null,
    showModel ? MODEL_NAMES[model] : null,
  ].filter(Boolean);
  const customInvalid = draft.range === "custom" && (!draft.from || !draft.to || draft.from > draft.to);

  const apply = () => {
    if (customInvalid) return;
    const patch: Record<string, string | null> =
      draft.range === "custom" ? { range: "custom", from: draft.from, to: draft.to } : { range: draft.range, from: null, to: null };
    if (showPlatform) patch.platform = draft.platform === "all" ? null : draft.platform;
    if (showModel) patch.model = draft.model;
    if (showCompare) patch.compare = draft.compare === DEFAULT_COMPARE ? null : draft.compare;
    update(patch);
    setOpen(false);
  };

  return (
    <div className="xl:hidden">
      <Button
        variant="outline"
        className="h-9 max-w-[58vw] gap-2 px-2.5 font-normal md:h-8 md:max-w-none"
        aria-label={`Filters: ${[rangeText, ...ariaTail].join(" · ")}`}
        onClick={() => {
          setDraft(initial);
          setOpen(true);
        }}
      >
        <SlidersHorizontalIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="num min-w-0 truncate">
          <span className="md:hidden">{rangeTextShort}</span>
          <span className="max-md:hidden">{rangeText}</span>
          {tail.length ? <span className="text-muted-foreground"> · {tail.join(" · ")}</span> : null}
        </span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn("gap-0", isMobile ? "max-h-[calc(100svh-env(safe-area-inset-top)-1.5rem)] pb-[env(safe-area-inset-bottom)]" : "w-[380px] sm:max-w-[380px]")}
        >
          {isMobile ? <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong" /> : null}
          <SheetHeader className="px-5 pt-4 pb-2">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Period{showCompare ? ", comparison" : ""}
              {showPlatform ? ", ad platform" : ""}
              {showModel ? " and attribution model" : ""}.
            </SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 gap-6 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-ui font-medium">Date range</legend>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Date range">
                {[...RANGE_PRESETS.map((p) => ({ key: p.key as string, label: p.short })), { key: "custom", label: "Custom" }].map((p) => (
                  <Chip key={p.key} checked={draft.range === p.key} onClick={() => setDraft((d) => ({ ...d, range: p.key }))}>
                    {p.label}
                  </Chip>
                ))}
              </div>
              {draft.range === "custom" ? (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-from" className="text-caption text-muted-foreground">
                      From
                    </Label>
                    <Input id="m-from" name="from" type="date" autoComplete="off" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="h-10" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-to" className="text-caption text-muted-foreground">
                      To
                    </Label>
                    <Input id="m-to" name="to" type="date" autoComplete="off" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="h-10" />
                  </div>
                  {customInvalid ? (
                    <p role="alert" className="col-span-2 text-caption text-destructive">
                      Pick a start date on or before the end date.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            {showCompare ? (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-ui font-medium">Compare to</legend>
                <div className="grid grid-cols-[1.35fr_1.25fr_0.8fr] gap-1.5" role="radiogroup" aria-label="Compare to">
                  {COMPARE_MODES.map((c) => (
                    <Chip key={c.key} checked={draft.compare === c.key} onClick={() => setDraft((d) => ({ ...d, compare: c.key }))}>
                      {c.key === "none" ? "None" : c.label}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {showPlatform ? (
              <div className="grid gap-2">
                <Label htmlFor="m-platform">Ad platform</Label>
                <NativeSelect id="m-platform" name="platform" value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))} className="[&>select]:h-10">
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
                <legend className="mb-2 text-ui font-medium">Attribution model</legend>
                <div className="grid gap-1.5" role="radiogroup" aria-label="Attribution model">
                  {Object.keys(MODELS).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={draft.model === k}
                      onClick={() => setDraft((d) => ({ ...d, model: k }))}
                      onKeyDown={onRadioKeyDown}
                      className={cn(
                        "flex min-h-13 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-[background-color,border-color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        draft.model === k ? "border-foreground/70 bg-fill" : "hover:bg-fill",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", draft.model === k ? "border-foreground" : "border-border-strong")}
                      >
                        {draft.model === k ? <span className="size-2 rounded-full bg-foreground" /> : null}
                      </span>
                      <span className="grid gap-0.5">
                        <span className="text-ui font-medium">{MODEL_NAMES[k]}</span>
                        <span className="text-caption text-muted-foreground">{MODEL_HINTS[k]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>

          <SheetFooter className="mt-0 grid grid-cols-[auto_1fr] gap-2 border-t bg-popover px-5 py-3">
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => setDraft({ range: DEFAULT_RANGE, from: start, to: end, platform: "all", model: "linear", compare: DEFAULT_COMPARE })}
            >
              Reset
            </Button>
            <Button className="h-10" disabled={customInvalid} onClick={apply}>
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
      onKeyDown={onRadioKeyDown}
      className={cn(
        "h-10 truncate rounded-md border px-2 text-ui font-medium transition-[background-color,border-color,color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "border-foreground/70 bg-fill text-foreground" : "text-muted-foreground hover:bg-fill hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
