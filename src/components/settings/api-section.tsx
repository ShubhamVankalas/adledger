"use client";

import { KeyRoundIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/settings";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { timeAgo } from "@/lib/format";
import { describeScopes, SCOPE_PRESETS, SCOPES, type ApiScope } from "@/lib/security/scopes";
import { cn } from "@/lib/utils";
import { Snippet } from "./code-snippet";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean; scopes: string[]; expiresAt: string | null; expired: boolean };

const EXPIRY = [
  { days: 0, label: "Never" },
  { days: 30, label: "In 30 days" },
  { days: 90, label: "In 90 days" },
  { days: 365, label: "In 1 year" },
];

/** Access picker: two presets and a custom set of scopes. Posts one `scope` field per scope. */
function ScopePicker({ canPii }: { canPii: boolean }) {
  const [mode, setMode] = useState<"read" | "readwrite" | "custom">("read");
  const [custom, setCustom] = useState<Set<ApiScope>>(new Set(["reports:read", "mcp"]));
  const name = useId();
  const options = [...SCOPE_PRESETS, { id: "custom" as const, label: "Custom", description: "Pick exactly what the key can do.", scopes: [] as ApiScope[] }];
  const preset = SCOPE_PRESETS.find((p) => p.id === mode);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">Access</legend>
      <div className="grid gap-1.5 @2xl/settings:grid-cols-3">
        {options.map((o) => (
          <label
            key={o.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-[border-color,background-color] has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              mode === o.id ? "border-foreground/30 bg-muted/50" : "hover:bg-muted/30",
            )}
          >
            <input type="radio" name={name} value={o.id} checked={mode === o.id} onChange={() => setMode(o.id)} className="mt-0.5 size-4 accent-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
      {preset ? preset.scopes.map((s) => <input key={s} type="hidden" name="scope" value={s} />) : null}
      {mode === "custom" ? (
        <div className="grid gap-1 rounded-lg border px-3 py-2">
          {SCOPES.map((s) => {
            const locked = s.scope === "contacts:pii" && !canPii;
            return (
              <label key={s.scope} className={cn("flex items-start gap-3 py-1.5", locked ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  name="scope"
                  value={s.scope}
                  disabled={locked}
                  checked={custom.has(s.scope)}
                  onChange={(e) =>
                    setCustom((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.scope);
                      else next.delete(s.scope);
                      return next;
                    })
                  }
                  className="mt-0.5 size-4 accent-foreground"
                />
                <span className="min-w-0">
                  <span className="block text-sm">
                    {s.label} <code className="ml-1 font-mono text-[11px] text-muted-foreground" translate="no">{s.scope}</code>
                  </span>
                  <span className="block text-xs text-pretty text-muted-foreground">{locked ? "Only owners and admins can grant this." : s.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
    </fieldset>
  );
}

const MCP_TOOLS = ["get_overview", "get_performance", "find_wasted_spend", "compare_periods", "list_contacts", "get_contact_journey", "get_latest_insights", "get_sync_status"];

export function ApiSection({ origin, keys, canPii }: { origin: string; keys: Key[]; canPii: boolean }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const create = useFormAction(createApiKeyAction, (r) => {
    if (!r.ok) return;
    setFresh(String(r.data?.key ?? ""));
    setFormKey((k) => k + 1);
  });
  const key = fresh ?? "al_YOUR_API_KEY";
  const mcpUrl = `${origin}/api/mcp`;

  return (
    <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @4xl/settings:grid-cols-5">
      <Card className="@4xl/settings:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-muted-foreground" /> API keys
          </CardTitle>
          <CardDescription>For MCP clients, scripts and dashboards. Each key sees one workspace and only what its access allows.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fresh ? (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="text-sm font-medium">Your new key — copy it now, it won&rsquo;t be shown again</div>
              <CopyField value={fresh} />
            </div>
          ) : null}
          <form key={formKey} action={create.submit} className="grid gap-4 rounded-lg border p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" name="name" autoComplete="off" maxLength={80} placeholder="e.g. Claude Desktop…" aria-label="Key name" />
            </div>
            <ScopePicker canPii={canPii} />
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="key-expires">Expires</Label>
                <NativeSelect id="key-expires" name="expiresDays" defaultValue="0" className="w-36">
                  {EXPIRY.map((e) => (
                    <option key={e.days} value={e.days}>
                      {e.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={create.pending} className="md:h-9">
                {create.pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                {create.pending ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
          <div className="divide-y rounded-lg border">
            {keys.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">No keys yet. Name one above to create it — you&rsquo;ll see it once.</p>
            ) : null}
            {keys.map((k) => {
              const expired = !k.revoked && k.expired;
              return (
              <div key={k.id} className="flex items-center justify-between gap-2 py-2 pr-2 pl-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className={k.revoked || expired ? "truncate text-muted-foreground line-through" : "truncate"}>{k.name}</span>
                    {k.revoked ? <Badge variant="outline">Revoked</Badge> : expired ? <Badge variant="outline">Expired</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {describeScopes(k.scopes)}
                    {k.scopes.includes("contacts:pii") ? <span className="font-medium text-foreground"> (sees emails)</span> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <code translate="no">{k.prefix}…</code> · used <span suppressHydrationWarning>{timeAgo(k.lastUsedAt)}</span>
                    {k.expiresAt && !k.revoked && !expired ? (
                      <span suppressHydrationWarning> · expires {new Date(k.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    ) : null}
                  </div>
                </div>
                {!k.revoked ? (
                  <ActionButton action={() => revokeApiKeyAction(k.id)} variant="ghost" size="sm" confirm="Revoke this key? Apps using it will stop working.">
                    Revoke
                  </ActionButton>
                ) : null}
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 @4xl/settings:col-span-3">
        <CardHeader>
          <CardTitle>Ask Claude (or any AI agent) about your ads</CardTitle>
          <CardDescription>
            AdLedger has a built-in, read-only MCP server. Try: <em>“Which campaigns made money last month and which wasted spend?”</em>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">MCP server URL</div>
            <CopyField value={mcpUrl} />
          </div>
          <Tabs defaultValue="code" className="min-w-0">
            {/* Scrolls sideways on narrow screens rather than squeezing the labels. */}
            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="max-md:h-10">
                <TabsTrigger value="code" className="flex-none px-2.5">
                  Claude Code
                </TabsTrigger>
                <TabsTrigger value="desktop" className="flex-none px-2.5">
                  Claude Desktop
                </TabsTrigger>
                <TabsTrigger value="cursor" className="flex-none px-2.5">
                  Cursor
                </TabsTrigger>
                <TabsTrigger value="rest" className="flex-none px-2.5">
                  REST API
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="code" className="pt-2">
              <Snippet label="Terminal" code={`claude mcp add --transport http adledger ${mcpUrl} \\\n  --header "Authorization: Bearer ${key}"`} />
            </TabsContent>
            <TabsContent value="desktop" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">Settings → Developer → Edit config, then restart Claude Desktop:</p>
              <Snippet
                label="claude_desktop_config.json"
                code={JSON.stringify(
                  { mcpServers: { adledger: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", `Authorization: Bearer ${key}`] } } },
                  null,
                  2,
                )}
              />
            </TabsContent>
            <TabsContent value="cursor" className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Add to <code translate="no">~/.cursor/mcp.json</code>:
              </p>
              <Snippet label="~/.cursor/mcp.json" code={JSON.stringify({ mcpServers: { adledger: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
            </TabsContent>
            <TabsContent value="rest" className="space-y-2 pt-2">
              <Snippet label="Terminal" code={`curl "${origin}/api/v1/reports/performance?start=2026-09-01&end=2026-09-30&model=linear&level=campaign" \\\n  -H "Authorization: Bearer ${key}"`} />
              <p className="text-xs text-muted-foreground">
                Reports: <code translate="no">overview</code>, <code translate="no">performance</code>, <code translate="no">timeseries</code>, <code translate="no">channels</code>, <code translate="no">wasted-spend</code>, <code translate="no">compare</code>. Also <code translate="no">/api/v1/contacts</code>.
              </p>
            </TabsContent>
          </Tabs>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {MCP_TOOLS.length} read-only tools. The agent can look things up but never change anything; contact emails are masked.
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="MCP tools" translate="no">
              {MCP_TOOLS.map((t) => (
                <li key={t} className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
