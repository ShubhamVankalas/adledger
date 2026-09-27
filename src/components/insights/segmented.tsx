"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented control built on native radio inputs, so it posts with its form, supports arrow
 * keys for free and reads as a radio group to screen readers. 28px (36 on touch), 6px radius.
 */
export function Segmented<T extends string>({
  name,
  options,
  value,
  defaultValue,
  onChange,
  label,
  className,
  size = "default",
}: {
  name: string;
  options: readonly { value: T; label: React.ReactNode; title?: string }[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
  size?: "default" | "sm";
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex w-fit max-w-full rounded-[7px] bg-fill p-0.5", size === "sm" ? "h-7" : "h-8 pointer-coarse:h-10", className)}
    >
      {options.map((o) => {
        const inputId = `${id}-${o.value}`;
        return (
          <label
            key={o.value}
            htmlFor={inputId}
            title={o.title}
            className="relative flex flex-auto cursor-pointer items-center justify-center rounded-[5px] px-2.5 text-ui whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:text-foreground has-checked:bg-surface has-checked:font-medium has-checked:text-foreground has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring"
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={o.value}
              className="sr-only"
              {...(value !== undefined ? { checked: value === o.value } : { defaultChecked: defaultValue === o.value })}
              onChange={() => onChange?.(o.value)}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
