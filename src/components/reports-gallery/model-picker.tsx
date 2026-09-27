"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

const MODELS = { linear: "Linear", first_touch: "First touch", last_touch: "Last touch" } as const;

/** Arrow keys move between (and select) options, like native radio buttons. */
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

/** Attribution model for every report on the page (kept in the URL as ?model=). */
export function ModelPicker({ model }: { model: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (m: string) => {
    const next = new URLSearchParams(sp.toString());
    if (m === "linear") next.delete("model");
    else next.set("model", m);
    const q = next.toString();
    start(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return (
    <div
      role="radiogroup"
      aria-label="Attribution model for reports"
      aria-busy={pending || undefined}
      className={cn("flex h-7 items-center rounded-[7px] bg-fill p-0.5 transition-opacity pointer-coarse:h-9", pending && "opacity-60")}
    >
      {Object.entries(MODELS).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={model === k}
          tabIndex={model === k ? 0 : -1}
          onClick={() => model !== k && set(k)}
          onKeyDown={onRadioKeyDown}
          className={cn(
            "h-full rounded-[5px] px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ease-out outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            model === k && "bg-surface text-foreground shadow-sm",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
