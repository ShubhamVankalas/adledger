"use client";

import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { METRICS, type MetricKey } from "@/lib/metrics";

/** ⓘ next to a metric label: its plain-language definition. Opens on hover, focus or tap. */
export function MetricInfo({ metric, extra }: { metric: MetricKey; extra?: string }) {
  const m = METRICS[metric];
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        aria-label={`What is ${m.label}?`}
        className="relative z-10 -m-1 grid size-6 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-8"
      >
        <InfoIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 gap-1.5 p-3 text-xs leading-relaxed">
        <p className="text-[13px] font-medium text-foreground">{m.label}</p>
        <p className="text-muted-foreground">{m.definition}</p>
        {extra ? <p className="text-muted-foreground">{extra}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
