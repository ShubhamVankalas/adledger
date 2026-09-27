"use client";

import { cn } from "@/lib/utils";

// Segmented control (brief: 28px, fill track, the selected option on a raised surface). A radio
// group: arrow keys move the selection, like native radio buttons.

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    onChange(next.value);
    const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[(i + step + options.length) % options.length]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-9 shrink-0 items-center rounded-[7px] bg-fill p-0.5 md:h-7", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "h-full rounded-[5px] px-2.5 text-caption whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              on && "bg-card font-medium text-foreground shadow-(--elev-sm)",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
