"use client";

import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/settings";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { timeAgo } from "@/lib/format";
import { Snippet } from "./code-snippet";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

export function ApiSection({ origin, keys }: { origin: string; keys: Key[] }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useFormAction(createApiKeyAction, (r) => r.ok && setFresh(String(r.data?.key ?? "")));
  const key = fresh ?? "al_YOUR_API_KEY";
  const mcpUrl = `${origin}/api/mcp`;

  return (
    <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @4xl/settings:grid-cols-5">
      <Card className="@4xl/settings:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-muted-foreground" /> API keys
          </CardTitle>
          <CardDescription>Read-only access to your reports for MCP clients, scripts and dashboards.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fresh ? (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="text-sm font-medium">Your new key — copy it now, it won&apos;t be shown again</div>
              <CopyField value={fresh} />
            </div>
          ) : null}
          <form action={create.submit} className="flex gap-2">
            <Input name="name" placeholder="Key name, e.g. Claude Desktop" aria-label="Key name" />
            <Button type="submit" disabled={create.pending} className="md:h-9">
              <PlusIcon /> Create
            </Button>
          </form>
          <div className="divide-y rounded-lg border">
            {keys.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">No keys yet. Name one above to create it — you&apos;ll see it once.</p>
            ) : null}
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 py-2 pr-2 pl-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className={k.revoked ? "truncate text-muted-foreground line-through" : "truncate"}>{k.name}</span>
                    {k.revoked ? <Badge variant="outline">revoked</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <code>{k.prefix}…</code> · used {timeAgo(k.lastUsedAt)}
                  </div>
                </div>
                {!k.revoked ? (
                  <ActionButton action={() => revokeApiKeyAction(k.id)} variant="ghost" size="sm" confirm="Revoke this key? Apps using it will stop working.">
                    Revoke
                  </ActionButton>
                ) : null}
              </div>
            ))}
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
                Add to <code>~/.cursor/mcp.json</code>:
              </p>
              <Snippet label="~/.cursor/mcp.json" code={JSON.stringify({ mcpServers: { adledger: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
            </TabsContent>
            <TabsContent value="rest" className="space-y-2 pt-2">
              <Snippet label="Terminal" code={`curl "${origin}/api/v1/reports/performance?start=2026-09-01&end=2026-09-30&model=linear&level=campaign" \\\n  -H "Authorization: Bearer ${key}"`} />
              <p className="text-xs text-muted-foreground">
                Reports: <code>overview</code>, <code>performance</code>, <code>timeseries</code>, <code>channels</code>, <code>wasted-spend</code>, <code>compare</code>. Also <code>/api/v1/contacts</code>.
              </p>
            </TabsContent>
          </Tabs>
          <p className="text-xs break-words text-muted-foreground">
            Tools: get_overview, get_performance, find_wasted_spend, compare_periods, list_contacts, get_contact_journey (emails masked), get_latest_insights, get_sync_status. All read-only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
