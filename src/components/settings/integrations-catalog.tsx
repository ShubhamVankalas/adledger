"use client";

import { ArrowRightIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { IntegrationMeta } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";
import { IntegrationDialog, StatusBadge, type IntegrationState } from "./integration-dialog";
import { IntegrationLogo } from "./integration-logo";

export type { IntegrationState };

const CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ads", label: "Ad platforms" },
  { key: "revenue", label: "Payments & stores" },
  { key: "website", label: "Website & forms" },
  { key: "import", label: "Import & API" },
];

/** Mirrors a piece of UI state in the query string (shareable, survives reload) without a navigation. */
function setParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
}

export function IntegrationsCatalog({
  integrations,
  states,
  forcedMock,
}: {
  integrations: IntegrationMeta[];
  states: Record<string, IntegrationState>;
  forcedMock: boolean;
}) {
  const sp = useSearchParams();
  const [cat, setCatState] = useState(() => {
    const c = sp.get("category");
    return CATEGORIES.some((x) => x.key === c) ? c! : "all";
  });
  const [q, setQ] = useState("");
  const [open, setOpenState] = useState<string | null>(sp.get("open"));
  const setCat = (c: string) => {
    setCatState(c);
    setParam("category", c === "all" ? null : c);
  };
  const setOpen = (p: string | null) => {
    setOpenState(p);
    setParam("open", p);
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return integrations
      .filter((i) => cat === "all" || i.category === cat || (cat === "website" && i.category === "leads"))
      .filter((i) => !needle || `${i.name} ${i.description}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(states[b.provider]?.connected ?? false) - Number(states[a.provider]?.connected ?? false));
  }, [integrations, states, cat, q]);

  const openMeta = integrations.find((i) => i.provider === open);

  return (
    <div className="space-y-4">
      {forcedMock ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <code translate="no">CONNECTOR_MODE=mock</code> is set on the server, so every connector returns demo data. Remove it to use live APIs.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 @3xl/settings:flex-row @3xl/settings:items-center @3xl/settings:justify-between">
        <div className="relative @3xl/settings:order-2 @3xl/settings:w-64 @5xl/settings:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search integrations…"
            aria-label="Search integrations"
            className="pl-8"
          />
        </div>
        {/* Scrolls sideways on phones instead of wrapping into a tall block. */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          <div role="group" aria-label="Category" className="flex w-max gap-1 rounded-lg border bg-muted/40 p-0.5">
            {CATEGORIES.map((c) => {
              const n = c.key === "all" ? integrations.length : integrations.filter((i) => i.category === c.key || (c.key === "website" && i.category === "leads")).length;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={cat === c.key}
                  onClick={() => setCat(c.key)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset md:h-8",
                    cat === c.key && "bg-background text-foreground shadow-sm dark:bg-input/50",
                  )}
                >
                  {c.label}
                  <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @xl/settings:grid-cols-2 @4xl/settings:grid-cols-3 @7xl/settings:grid-cols-4">
        {list.map((i) => {
          const st = states[i.provider];
          const builtIn = i.fields.length === 0;
          const body = (
            <>
              <div className="flex items-start gap-3">
                <IntegrationLogo provider={i.provider} name={i.name} color={i.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 leading-snug font-medium break-words">{i.name}</span>
                    {i.status === "beta" ? (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        Beta
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs">
                {st ? <StatusBadge state={st} forcedMock={forcedMock} /> : <span />}
                <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                  {builtIn ? "Open" : st?.connected ? "Manage" : "Connect"} <ArrowRightIcon className="size-3" />
                </span>
              </div>
            </>
          );
          const cls = "flex h-full min-w-0 flex-col rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50";
          return builtIn ? (
            <Link key={i.provider} href={i.docsUrl} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={i.provider} type="button" onClick={() => setOpen(i.provider)} className={cls}>
              {body}
            </button>
          );
        })}
        {list.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {q.trim() ? `No integration matches “${q.trim()}”.` : "Nothing in this category yet."} You can still bring the data in with a CSV file or the Spend &amp; Conversions API under{" "}
            <Link href="/settings/workspace/import" className="font-medium text-primary hover:underline">
              Import data
            </Link>
            .
          </p>
        ) : null}
      </div>

      {openMeta && states[openMeta.provider] ? (
        <IntegrationDialog meta={openMeta} state={states[openMeta.provider]} open={!!open} onOpenChange={(o) => !o && setOpen(null)} />
      ) : null}
    </div>
  );
}
