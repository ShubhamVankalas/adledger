"use client";

import { cn } from "@/lib/utils";

/** Arrow keys move between (and select) the options, like native radio buttons. */
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

/** The filter bar's segmented control (28px pill track, raised thumb on the selected option). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("flex h-7 items-center rounded-[7px] bg-fill p-0.5 max-sm:h-9 max-sm:w-full", className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => value !== o.value && onChange(o.value)}
          onKeyDown={onRadioKeyDown}
          className={cn(
            "flex h-full items-center justify-center gap-1 rounded-[5px] px-2 text-caption max-sm:flex-1 font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ease-out outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:px-3 sm:px-2.5",
            value === o.value && "bg-surface text-foreground shadow-sm",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="text-fg-faint tabular-nums">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
