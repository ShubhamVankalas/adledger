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

export function IntegrationsCatalog({
  integrations,
  states,
  forcedMock,
}: {
  integrations: IntegrationMeta[];
  states: Record<string, IntegrationState>;
  forcedMock: boolean;
}) {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const sp = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get("open"));

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
          <code>CONNECTOR_MODE=mock</code> is set on the server, so every connector returns demo data. Remove it to use live APIs.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-0.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(c.key)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                cat === c.key && "bg-background text-foreground shadow-sm",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations…" className="h-8 pl-8" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((i) => {
          const st = states[i.provider];
          const builtIn = i.fields.length === 0;
          const body = (
            <>
              <div className="flex items-start gap-3">
                <IntegrationLogo provider={i.provider} name={i.name} color={i.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{i.name}</span>
                    {i.status === "beta" ? (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        Beta
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between pt-3 text-xs">
                {st ? <StatusBadge state={st} forcedMock={forcedMock} /> : <span />}
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  {builtIn ? "Open" : st?.connected ? "Manage" : "Connect"} <ArrowRightIcon className="size-3" />
                </span>
              </div>
            </>
          );
          const cls = "flex h-full flex-col rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm";
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
            No integration matches “{q}”. You can still bring the data in with a CSV file or the Spend &amp; Conversions API under{" "}
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
