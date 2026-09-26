import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { PageBody, PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { listConnections, getConnection, secretKeysOf } from "@/lib/settings";
import { ApiSection } from "./api-section";
import { AiSection } from "./ai-section";
import { ConnectionsSection } from "./connections-section";
import { TrackingSection } from "./tracking-section";
import { WorkspaceSection } from "./workspace-section";

export const metadata = { title: "Settings" };

const TABS = ["tracking", "connections", "ai", "api", "workspace"] as const;

async function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0];
  return `${proto}://${host}`;
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const ws = user.workspace;
  const sp = await searchParams;
  const tab = TABS.includes(sp.tab as (typeof TABS)[number]) ? (sp.tab as string) : "tracking";
  const db = await getDb();
  const [origin, sites, hooks, conns, keys, runs, llm] = await Promise.all([
    publicUrl(),
    db.select().from(schema.pixelSites).where(eq(schema.pixelSites.workspaceId, ws.id)).orderBy(schema.pixelSites.createdAt),
    db.select().from(schema.leadWebhooks).where(eq(schema.leadWebhooks.workspaceId, ws.id)).orderBy(schema.leadWebhooks.createdAt),
    listConnections(ws.id, db),
    db.select().from(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, ws.id)).orderBy(desc(schema.apiKeys.createdAt)),
    db.select().from(schema.syncRuns).where(eq(schema.syncRuns.workspaceId, ws.id)).orderBy(desc(schema.syncRuns.startedAt)).limit(30),
    getLlmConfig(ws, db),
  ]);

  const connInfo = await Promise.all(
    (["meta", "google_ads", "stripe"] as const).map(async (p) => {
      const c = conns.find((x) => x.provider === p);
      const full = c ? await getConnection(ws.id, p, db) : undefined;
      return {
        provider: p,
        connected: Boolean(c),
        mode: c?.mode ?? null,
        config: c?.config ?? {},
        secretKeys: secretKeysOf(full),
        lastSyncedAt: c?.lastSyncedAt?.toISOString() ?? null,
        lastError: c?.lastError ?? null,
        runs: runs
          .filter((r) => r.provider === p)
          .slice(0, 5)
          .map((r) => ({ status: r.status, startedAt: r.startedAt.toISOString(), rows: r.rowsUpserted, error: r.error })),
      };
    }),
  );
  const llmConn = conns.find((c) => c.provider === "llm");

  return (
    <>
      <PageHeader title="Settings" description="Tracking, connections, AI model, API keys and workspace" />
      <PageBody>
        <Tabs defaultValue={tab} className="gap-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
            <TabsTrigger value="tracking">Tracking</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="ai">AI model</TabsTrigger>
            <TabsTrigger value="api">API &amp; MCP</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
          </TabsList>
          <TabsContent value="tracking">
            <TrackingSection
              origin={origin}
              sites={sites.map((s) => ({ id: s.id, name: s.name, domains: s.domains, publicKey: s.publicKey }))}
              hooks={hooks.map((h) => ({ id: h.id, name: h.name, token: h.token }))}
            />
          </TabsContent>
          <TabsContent value="connections">
            <ConnectionsSection origin={origin} workspaceId={ws.id} connections={connInfo} forcedMock={process.env.CONNECTOR_MODE === "mock"} />
          </TabsContent>
          <TabsContent value="ai">
            <AiSection
              current={llm ? { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl ?? "", hasKey: Boolean(llm.apiKey), fromEnv: !llmConn } : null}
            />
          </TabsContent>
          <TabsContent value="api">
            <ApiSection
              origin={origin}
              keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revoked: Boolean(k.revokedAt) }))}
            />
          </TabsContent>
          <TabsContent value="workspace">
            <WorkspaceSection
              workspace={{ name: ws.name, reportingCurrency: ws.reportingCurrency, timezone: ws.timezone, attributionWindowDays: ws.attributionWindowDays, isDemo: ws.isDemo }}
              email={user.email}
            />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
