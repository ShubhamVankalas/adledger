"use client";

import { Fragment, useSyncExternalStore } from "react";
import { hotkeyKeycaps, hotkeyText, isApplePlatform } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

const noop = () => () => undefined;

/** ⌘ on Apple platforms, Ctrl elsewhere. Renders "Ctrl" on the server, then corrects itself without a hydration warning. */
export function useIsApple(): boolean {
  return useSyncExternalStore(noop, isApplePlatform, () => false);
}

export const KBD =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-muted px-1.5 font-sans text-[11px] leading-4 font-medium text-muted-foreground tabular-nums shadow-[inset_0_-1px_0_var(--color-input)]";

/**
 * Keycaps for a registry key string: "g o" → [G] then [O], "mod+k" → [⌘][K] / [Ctrl][K].
 * `then` spells out sequences ("G then O") for the shortcuts sheet; the palette shows them compact.
 */
export function Keycaps({ keys, then = false, className }: { keys: string; then?: boolean; className?: string }) {
  const apple = useIsApple();
  const steps = hotkeyKeycaps(keys, apple);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} aria-label={hotkeyText(keys, apple)} role="img">
      {steps.map((caps, i) => (
        <Fragment key={i}>
          {i > 0 && then ? <span aria-hidden className="px-0.5 text-[11px] text-muted-foreground/80">then</span> : null}
          {caps.map((c, j) => (
            <kbd key={j} aria-hidden className={KBD}>
              {c}
            </kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
