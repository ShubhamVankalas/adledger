"use client";

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { resetDashboardAction, saveDashboardAction, togglePinAction } from "@/app/actions/dashboard";
import { sameLayout, togglePin } from "@/lib/dashboard/ops";
import { presetLayout } from "@/lib/dashboard/presets";
import type { DashboardScope, Layout, PresetKey } from "@/lib/dashboard/types";
import type { MetricKey } from "@/lib/metrics";

// Client state for the Overview board: the saved layout, the edit-mode draft, which metric the
// Metric explorer shows, and the actions (save, reset, pin) that go to src/app/actions/dashboard.ts.

export type BoardSource = "personal" | "workspace" | "preset";

export type DashboardInitial = {
  layout: Layout;
  preset: PresetKey;
  source: BoardSource;
  versions: Record<DashboardScope, number>;
  workspaceLayout: Layout;
  workspacePreset: PresetKey;
  canEditWorkspace: boolean;
  initialEditing: boolean;
  initialMetric: MetricKey | null;
};

type Saved = Pick<DashboardInitial, "layout" | "preset" | "source" | "versions" | "workspaceLayout" | "workspacePreset">;

type Ctx = {
  /** What the board shows: the draft while editing, else the saved layout. */
  layout: Layout;
  saved: Saved;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  scope: DashboardScope;
  preset: PresetKey;
  canEditWorkspace: boolean;
  metric: MetricKey | null;
  selectMetric: (m: MetricKey) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  setDraft: (update: (l: Layout) => Layout) => void;
  setScope: (s: DashboardScope) => void;
  resetDraft: (to: PresetKey | "workspace") => void;
  save: () => void;
  togglePinned: (type: string) => void;
  resetPersonal: () => void;
};

const DashboardContext = createContext<Ctx | null>(null);

export function useDashboard(): Ctx {
  const ctx = use(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside <DashboardProvider>");
  return ctx;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog],[role=menu],[role=listbox]"));

function replaceQuery(patch: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  // Next.js keeps useSearchParams in sync with native history calls; no server round trip.
  window.history.replaceState(window.history.state, "", url);
}

const sigOf = (i: Saved) => `${i.source}:${i.versions.personal}:${i.versions.workspace}:${i.preset}`;

export function DashboardProvider({ initial, children }: { initial: DashboardInitial; children: React.ReactNode }) {
  const pick = (i: DashboardInitial): Saved => ({
    layout: i.layout,
    preset: i.preset,
    source: i.source,
    versions: i.versions,
    workspaceLayout: i.workspaceLayout,
    workspacePreset: i.workspacePreset,
  });
  const [saved, setSaved] = useState<Saved>(() => pick(initial));
  const [editing, setEditing] = useState(initial.initialEditing);
  const [draft, setDraftState] = useState<Layout>(initial.layout);
  const [draftPreset, setDraftPreset] = useState<PresetKey>(initial.preset);
  const defaultScope = (s: Saved): DashboardScope => (s.source === "personal" || !initial.canEditWorkspace ? "personal" : "workspace");
  const [scope, setScope] = useState<DashboardScope>(() => defaultScope(pick(initial)));
  const [metric, setMetric] = useState<MetricKey | null>(initial.initialMetric);
  const [saving, startSaving] = useTransition();

  // A fresh server render (after a save, or a teammate's change on reload) replaces the saved
  // state, unless the member is in the middle of editing.
  const [seenSig, setSeenSig] = useState(() => sigOf(pick(initial)));
  const incoming = pick(initial);
  if (sigOf(incoming) !== seenSig && !editing) {
    setSeenSig(sigOf(incoming));
    setSaved(incoming);
    setDraftState(incoming.layout);
  }

  const dirty = editing && (!sameLayout(draft, saved.layout) || draftPreset !== saved.preset);

  const startEditing = useCallback(() => {
    setDraftState(saved.layout);
    setDraftPreset(saved.preset);
    setScope(defaultScope(saved));
    setEditing(true);
    replaceQuery({ edit: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const stopEditing = useCallback(() => {
    setEditing(false);
    replaceQuery({ edit: null });
  }, []);

  const cancelEditing = useCallback(() => {
    setDraftState(saved.layout);
    setDraftPreset(saved.preset);
    stopEditing();
  }, [saved, stopEditing]);

  const setDraft = useCallback((update: (l: Layout) => Layout) => setDraftState((l) => update(l)), []);

  const resetDraft = useCallback(
    (to: PresetKey | "workspace") => {
      if (to === "workspace") {
        setDraftState(saved.workspaceLayout);
        setDraftPreset(saved.workspacePreset);
      } else {
        setDraftState(presetLayout(to));
        setDraftPreset(to);
      }
    },
    [saved],
  );

  const save = useCallback(() => {
    startSaving(async () => {
      // A personal view identical to the workspace default is just the default: drop the override.
      const backToDefault = scope === "personal" && saved.source === "personal" && sameLayout(draft, saved.workspaceLayout);
      const res = backToDefault
        ? await resetDashboardAction({ scope: "personal" })
        : await saveDashboardAction({ scope, layout: draft, preset: draftPreset, version: saved.versions[scope] });
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't save the layout.");
        return;
      }
      const version = typeof res.data?.version === "number" ? res.data.version : saved.versions[scope];
      const layout = (res.data?.layout as Layout | undefined) ?? draft;
      setSaved((s) => {
        if (backToDefault) return { ...s, layout: s.workspaceLayout, preset: s.workspacePreset, source: s.versions.workspace ? "workspace" : "preset", versions: { ...s.versions, personal: 0 } };
        const versions = { ...s.versions, [scope]: version };
        if (scope === "personal") return { ...s, layout, preset: draftPreset, source: "personal", versions };
        // Saving the workspace default: members with a personal view keep seeing theirs.
        const next = { ...s, workspaceLayout: layout, workspacePreset: draftPreset, versions };
        return s.source === "personal" ? next : { ...next, layout, preset: draftPreset, source: "workspace" };
      });
      stopEditing();
      toast.success(
        scope === "workspace" && saved.source === "personal" ? "Saved as the workspace default. You still see your personal view." : (res.message ?? "Layout saved."),
      );
    });
  }, [scope, saved, draft, draftPreset, stopEditing]);

  const pinBusy = useRef(false);
  const togglePinned = useCallback(
    (type: string) => {
      if (pinBusy.current) return;
      const before = saved.layout;
      const next = togglePin(before, type);
      if (!next) {
        toast.error("The strip holds six tiles. Unpin one first.");
        return;
      }
      pinBusy.current = true;
      setSaved((s) => ({ ...s, layout: next.layout }));
      void togglePinAction({ type })
        .then((res) => {
          if (!res.ok) {
            setSaved((s) => ({ ...s, layout: before }));
            toast.error(res.message ?? "Couldn't change the pinned tiles.");
            return;
          }
          const resScope = res.data?.scope === "workspace" ? "workspace" : "personal";
          const version = Number(res.data?.version ?? 0);
          setSaved((s) => ({
            ...s,
            layout: (res.data?.layout as Layout | undefined) ?? s.layout,
            source: resScope === "personal" ? "personal" : s.source === "preset" ? "workspace" : s.source,
            versions: { ...s.versions, [resScope]: version },
          }));
          toast(res.message ?? (next.pinned ? "Pinned." : "Unpinned."), {
            action: {
              label: "Undo",
              onClick: () => {
                setSaved((s) => ({ ...s, layout: before }));
                void saveDashboardAction({ scope: resScope, layout: before, preset: saved.preset, version }).then((undo) => {
                  if (!undo.ok) toast.error(undo.message ?? "Couldn't undo.");
                  else setSaved((s) => ({ ...s, versions: { ...s.versions, [resScope]: Number(undo.data?.version ?? version) } }));
                });
              },
            },
          });
        })
        .finally(() => {
          pinBusy.current = false;
        });
    },
    [saved],
  );

  const resetPersonal = useCallback(() => {
    startSaving(async () => {
      const res = await resetDashboardAction({ scope: "personal" });
      if (!res.ok) {
        toast.error(res.message ?? "Couldn't reset the layout.");
        return;
      }
      setSaved((s) => ({ ...s, layout: s.workspaceLayout, preset: s.workspacePreset, source: s.versions.workspace ? "workspace" : "preset", versions: { ...s.versions, personal: 0 } }));
      toast.success(res.message ?? "Back to the workspace default.");
    });
  }, []);

  const selectMetric = useCallback((m: MetricKey) => {
    setMetric(m);
    replaceQuery({ metric: m });
    const explorer = document.querySelector<HTMLElement>("[data-widget-type='chart.explorer']");
    if (explorer) {
      const r = explorer.getBoundingClientRect();
      if (r.top > window.innerHeight - 120 || r.bottom < 80) {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        explorer.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
      }
    }
  }, []);

  // "E" toggles edit mode (ignored while typing or when a modifier is held).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      if (!editing) startEditing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, startEditing]);

  // Warn before leaving with unsaved layout changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const value = useMemo<Ctx>(
    () => ({
      layout: editing ? draft : saved.layout,
      saved,
      editing,
      dirty,
      saving,
      scope,
      preset: editing ? draftPreset : saved.preset,
      canEditWorkspace: initial.canEditWorkspace,
      metric,
      selectMetric,
      startEditing,
      cancelEditing,
      setDraft,
      setScope,
      resetDraft,
      save,
      togglePinned,
      resetPersonal,
    }),
    [editing, draft, saved, dirty, saving, scope, draftPreset, initial.canEditWorkspace, metric, selectMetric, startEditing, cancelEditing, setDraft, resetDraft, save, togglePinned, resetPersonal],
  );

  return <DashboardContext value={value}>{children}</DashboardContext>;
}
