"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishOAuthConnectAction } from "@/app/actions/oauth";
import { useFormAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import type { AdAccountOption } from "@/lib/oauth/providers";

/** Checklist of the ad accounts a one-click sign-in can see; saving imports the ticked ones. */
export function OAuthAccountPicker({
  provider,
  label,
  accounts,
  preselected,
}: {
  provider: string;
  label: string;
  accounts: AdAccountOption[];
  preselected: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set(preselected));
  const save = useFormAction(
    (f) => finishOAuthConnectAction(provider, f),
    (r) => {
      if (r.ok) router.push("/settings/workspace/integrations");
    },
  );
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = selected.size === accounts.length;

  return (
    <form action={save.submit} className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"} found · {selected.size} selected
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(all ? new Set() : new Set(accounts.map((a) => a.id)))}>
          {all ? "Select none" : "Select all"}
        </Button>
      </div>
      <ul className="divide-y rounded-lg border">
        {accounts.map((a) => (
          <li key={a.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50">
              <input
                type="checkbox"
                name="account"
                value={a.id}
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium break-words">{a.name}</span>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  <span translate="no">{a.id}</span>
                  {a.currency ? ` · ${a.currency}` : ""}
                  {a.note ? ` · ${a.note}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button type="submit" className="max-sm:w-full" disabled={save.pending || selected.size === 0}>
          {save.pending ? <Loader2Icon className="animate-spin" /> : null}
          {save.pending ? "Importing…" : `Import ${selected.size === 1 ? "1 account" : `${selected.size} accounts`}`}
        </Button>
        <p className="text-xs text-muted-foreground">
          AdLedger only reads spend and performance. The {label} access is stored encrypted on this server.
        </p>
      </div>
    </form>
  );
}
