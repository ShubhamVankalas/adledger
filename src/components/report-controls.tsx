"use client";

import { CalendarIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const RANGES = { "7d": "Last 7 days", "14d": "Last 14 days", "30d": "Last 30 days", "90d": "Last 90 days", "180d": "Last 180 days", custom: "Custom range" };
const MODELS = { linear: "Linear", first_touch: "First touch", last_touch: "Last touch" };
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

export function ReportControls({
  start,
  end,
  range,
  model,
  platform,
  showPlatform = true,
}: {
  start: string;
  end: string;
  range: string;
  model: string;
  platform?: string;
  showPlatform?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <Select
        items={RANGES}
        value={range}
        onValueChange={(v) => {
          if (v === "custom") setCustomOpen(true);
          else update({ range: String(v), from: null, to: null });
        }}
      >
        <SelectTrigger size="sm" className="min-w-36">
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
          <PopoverTrigger render={<Button variant="outline" size="sm" className="tabular" />}>
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
              <Button type="submit" size="sm">
                Apply
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}

      {showPlatform ? (
        <Select items={PLATFORMS} value={platform ?? "all"} onValueChange={(v) => update({ platform: v === "all" ? null : String(v) })}>
          <SelectTrigger size="sm" className="min-w-32">
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

      <div className="flex items-center rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label="Attribution model">
        {Object.entries(MODELS).map(([k, v]) => (
          <button
            key={k}
            role="radio"
            aria-checked={model === k}
            onClick={() => update({ model: k })}
            className={cn(
              "h-6 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              model === k && "bg-background text-foreground shadow-sm",
            )}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
