"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useHotkeys, type HotkeyDef } from "@/lib/hotkeys";
import { NAV, navVisible, type PaletteCan } from "./command-palette-data";
import { OPEN_PALETTE_EVENT, pushRecent } from "./command-palette-store";

export { openCommandPalette, openShortcutsSheet, OPEN_PALETTE_EVENT, OPEN_SHORTCUTS_EVENT } from "./command-palette-store";

// The ⌘K palette's always-mounted shell: global shortcuts (⌘K / Ctrl K, G then a letter, "/"),
// the `adledger:open-palette` window event, and "Recent" page visits. The dialog itself is a
// separate chunk, fetched when the browser is idle so the first ⌘K still opens instantly.

const loadDialog = () => import("./command-palette-dialog");
const PaletteDialog = dynamic(() => loadDialog().then((m) => m.PaletteDialog), { ssr: false });

type State = { open: boolean; via: "keyboard" | "pointer"; query: string; session: number };

export function CommandPalette({ workspaceId, can }: { workspaceId: string; can: PaletteCan }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>({ open: false, via: "pointer", query: "", session: 0 });

  useEffect(() => {
    const preload = () => void loadDialog();
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(preload, 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const query = (e as CustomEvent<{ query?: string } | undefined>).detail?.query;
      setState((s) => ({ open: true, via: "pointer", query: typeof query === "string" ? query : "", session: s.session + 1 }));
    };
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
  }, []);

  // Remember visits to top-level pages and settings sections for "Recent".
  useEffect(() => {
    const page = NAV.find((n) => n.href === pathname);
    if (page) pushRecent(workspaceId, { id: page.id, label: page.label, subtitle: page.section ?? null, href: page.href, kind: "page" });
  }, [pathname, workspaceId]);

  const shortcuts: HotkeyDef[] = [
    {
      id: "palette.toggle",
      keys: "mod+k",
      label: "Open the command palette",
      group: "General",
      allowInInputs: true,
      run: () => setState((s) => (s.open ? { ...s, open: false } : { open: true, via: "keyboard", query: "", session: s.session + 1 })),
    },
    {
      id: "page.search",
      keys: "/",
      label: "Search this page",
      group: "General",
      run: () => {
        const el = document.querySelector<HTMLElement>("[data-hotkey-search]");
        if (!el) return false;
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      },
    },
    ...NAV.filter((n) => n.hotkey && navVisible(n, can)).map<HotkeyDef>((n) => ({
      id: `go.${n.id}`,
      keys: n.hotkey!,
      label: `Go to ${n.label}`,
      group: "Go to",
      run: () => router.push(n.href),
    })),
  ];
  useHotkeys(shortcuts);

  if (state.session === 0) return null;
  return (
    <PaletteDialog
      open={state.open}
      onOpenChange={(open) => setState((s) => ({ ...s, open }))}
      via={state.via}
      initialQuery={state.query}
      session={state.session}
      workspaceId={workspaceId}
      can={can}
    />
  );
}
