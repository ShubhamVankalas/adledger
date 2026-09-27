"use client";

import { CheckIcon, Settings2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PRESETS, type ColumnKey, type Density, type PresetKey } from "./columns";

const ColumnChooser = dynamic(() => import("./column-chooser"), {
  ssr: false,
  loading: () => (
    <div className="space-y-1" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  ),
});

/** The Display popover: column presets, the column chooser and row density. */
export function DisplayMenu({
  preset,
  columns,
  density,
  onPreset,
  onColumns,
  onDensity,
  className,
}: {
  preset: PresetKey;
  columns: ColumnKey[];
  density: Density;
  onPreset: (p: Exclude<PresetKey, "custom">) => void;
  onColumns: (cols: ColumnKey[]) => void;
  onDensity: (d: Density) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = preset === "custom" ? "Custom" : PRESETS.find((p) => p.key === preset)?.label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`Display: ${label} columns, ${density} rows`} className={cn("h-10 w-10 px-0 font-normal @3xl:h-7 @3xl:w-auto @3xl:px-2.5", className)} />
        }
      >
        <Settings2Icon aria-hidden className="text-muted-foreground" />
        <span className="hidden @3xl:inline">Display</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(36rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-y-auto overscroll-contain p-0">
        <section aria-labelledby="display-presets" className="border-b p-3">
          <h2 id="display-presets" className="mb-1.5 text-caption font-medium text-muted-foreground">
            Columns preset
          </h2>
          <div role="radiogroup" aria-labelledby="display-presets" className="grid grid-cols-2 gap-1">
            {PRESETS.map((p) => {
              const on = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onPreset(p.key)}
                  className={cn(
                    "flex flex-col items-start rounded-md border px-2 py-1.5 text-left outline-none transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    on ? "border-border-strong bg-fill-active" : "border-border hover:bg-fill",
                  )}
                >
                  <span className="flex w-full items-center justify-between text-ui font-medium">
                    {p.label}
                    {on ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                  </span>
                  <span className="text-micro font-normal text-muted-foreground">{p.hint}</span>
                </button>
              );
            })}
          </div>
          {preset === "custom" ? <p className="mt-2 text-caption text-muted-foreground">Custom columns. Pick a preset to start over.</p> : null}
        </section>
        <section aria-labelledby="display-columns" className="border-b p-3">
          <h2 id="display-columns" className="mb-1.5 text-caption font-medium text-muted-foreground">
            Columns
          </h2>
          {open ? <ColumnChooser columns={columns} onChange={onColumns} /> : null}
        </section>
        <section aria-labelledby="display-density" className="flex items-center justify-between gap-3 p-3">
          <h2 id="display-density" className="text-caption font-medium text-muted-foreground">
            Rows
          </h2>
          <div role="radiogroup" aria-labelledby="display-density" className="flex h-7 items-center rounded-[7px] bg-fill p-0.5">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={density === d}
                onClick={() => onDensity(d)}
                className={cn(
                  "h-full rounded-[5px] px-2.5 text-ui font-medium text-muted-foreground capitalize outline-none transition-[color,background-color,box-shadow] duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  density === d && "bg-surface text-foreground shadow-sm",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
