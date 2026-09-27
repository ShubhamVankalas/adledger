"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { readTableState, tableStatePatch, type TableState } from "./columns";

/**
 * The table's display state (columns, sort, density, mode, peek) lives in the URL but never
 * needs the server: changes go through the native History API, which Next.js syncs into
 * useSearchParams without re-rendering the page on the server. Sort, columns and density replace
 * the current entry; opening a peek pushes one, so Back closes it.
 */
export function useTableUrl() {
  const sp = useSearchParams();
  const state = useMemo(() => readTableState(sp), [sp]);
  const set = useCallback((patch: Partial<TableState>, opts: { push?: boolean } = {}) => {
    writeParams(tableStatePatch(patch), opts);
  }, []);
  return { state, set, params: sp };
}

/** Apply a patch (null deletes a key) to the current URL with pushState or replaceState. */
export function writeParams(patch: Record<string, string | null>, opts: { push?: boolean } = {}) {
  const next = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (opts.push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}
