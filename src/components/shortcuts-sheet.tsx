"use client";

import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Keycaps } from "@/components/keycaps";
import { useHotkeyList, useHotkeys, type HotkeyDef } from "@/lib/hotkeys";
import { OPEN_SHORTCUTS_EVENT } from "./command-palette-store";

// The "?" sheet: every shortcut registered right now (global ones plus the current page's),
// read straight from the hotkey registry. Also opens on the `adledger:open-shortcuts` event.

const GROUP_ORDER = ["General", "Go to"];

function grouped(list: readonly HotkeyDef[]) {
  const map = new Map<string, HotkeyDef[]>();
  for (const h of list) {
    if (h.hidden) continue;
    map.set(h.group, [...(map.get(h.group) ?? []), h]);
  }
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b));
}

export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const list = useHotkeyList();
  const [shownFor, setShownFor] = useState(pathname);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A shortcut that navigates closes the sheet (adjusting state during render, not in an effect).
  if (pathname !== shownFor) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
  }, []);

  useHotkeys([{ id: "shortcuts.open", keys: "?", label: "Show keyboard shortcuts", group: "General", run: () => setOpen(true) }]);

  const groups = grouped(list);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[oklch(0.2_0.01_165/0.28)] dark:bg-black/55" />
        <Dialog.Popup
          // Focus the list itself (arrow keys scroll it) instead of ringing the close button on open.
          initialFocus={bodyRef}
          className={
            "fixed z-50 flex flex-col overflow-hidden bg-popover text-popover-foreground outline-none " +
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[85dvh] max-sm:rounded-t-xl max-sm:pb-[env(safe-area-inset-bottom)] " +
            "sm:top-1/2 sm:left-1/2 sm:max-h-[min(40rem,calc(100dvh-4rem))] sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl " +
            "shadow-[0_0_0_1px_oklch(0.2_0.02_165/0.08),0_8px_16px_-4px_oklch(0.2_0.02_165/0.08),0_24px_48px_-8px_oklch(0.2_0.02_165/0.18)] dark:shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_16px_48px_oklch(0_0_0/0.5)]"
          }
        >
          <div className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-border pr-2 pl-5">
            <Dialog.Title className="text-base font-semibold tracking-[-0.011em] text-foreground">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
            >
              <XIcon aria-hidden className="size-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Shortcuts work anywhere outside text fields. Sequences like G then O must be typed within a second.</Dialog.Description>
          <div ref={bodyRef} tabIndex={-1} className="grid min-h-0 flex-1 gap-x-10 outline-none gap-y-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-6 sm:grid-cols-2">
            {groups.map(([group, items]) => (
              <section key={group} aria-labelledby={`shortcut-group-${group}`} className="min-w-0">
                <h3 id={`shortcut-group-${group}`} className="mb-1 text-[11px] leading-4 font-medium tracking-[0.04em] text-muted-foreground/80 uppercase">
                  {group}
                </h3>
                <ul className="divide-y divide-border/70">
                  {items.map((h) => (
                    <li key={h.id} className="flex min-h-9 items-center justify-between gap-4 py-1.5 text-[13px]">
                      <span className="min-w-0 text-foreground">{h.label}</span>
                      <Keycaps keys={h.keys} then />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="hidden shrink-0 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:block">
            Shortcuts are off while you type in a field. Press <Keycaps keys="mod+k" className="mx-0.5 align-middle" /> to find anything else.
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
