import { ArrowRightIcon, BookOpenIcon, KeyRoundIcon, SendIcon, WebhookIcon } from "lucide-react";
import Link from "next/link";
import { gatePage } from "@/components/access-denied";
import { CopyField } from "@/components/copy-field";
import { KpiCard } from "@/components/kpi-card";
import { Snippet } from "@/components/settings/code-snippet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { developerStats } from "@/lib/developers";
import { num } from "@/lib/format";
import { publicUrl } from "@/lib/url";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/catalog";

export const metadata = { title: "Developers" };

const DOCS = "https://github.com/ShubhamVankalas/adledger/blob/main/docs";

export default async function DevelopersOverviewPage() {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  const db = await getDb();
  const [origin, stats] = await Promise.all([publicUrl(), developerStats(db, user.workspace.id)]);
  const canKeys = user.can("apikeys.manage");
  const canHooks = user.can("developers.access");
  const attempted = stats.delivered24h + stats.failed24h;

  const steps = [
    {
      icon: KeyRoundIcon,
      title: "Create an API key",
      text: "Keys belong to this workspace and only get the scopes you pick. Read-only is the default.",
      action: canKeys ? { href: "/developers/keys", label: "Create a key" } : null,
    },
    {
      icon: SendIcon,
      title: "Make your first call",
      text: "Every number in the dashboard is one GET away. Money is in minor units (cents) with an ISO currency.",
      action: { href: "/developers/reference", label: "Browse the API" },
      code: `curl "${origin}/api/v1/reports/overview?start=2026-09-01&end=2026-09-30" \\\n  -H "Authorization: Bearer al_YOUR_API_KEY"`,
    },
    {
      icon: WebhookIcon,
      title: "Get events in real time",
      text: "New lead, new customer, a deal moved or a refund: AdLedger POSTs a signed JSON event to your URL within seconds.",
      action: canHooks ? { href: "/developers/webhooks", label: "Add a webhook" } : { href: "/developers/recipes", label: "See recipes" },
    },
  ];

  return (
    <>
      <section aria-label="At a glance" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Active API keys" value={num(stats.activeKeys)} icon={KeyRoundIcon} sub={canKeys ? "Not revoked or expired" : "Managed by admins"} />
        <KpiCard label="Webhook endpoints" value={num(stats.activeEndpoints)} icon={WebhookIcon} sub={stats.activeEndpoints === 1 ? "Receiving events" : "Turned on"} />
        <KpiCard
          label="Deliveries, 24 h"
          value={num(stats.delivered24h)}
          icon={SendIcon}
          sub={attempted === 0 ? "Nothing sent yet" : stats.failed24h ? `${num(stats.failed24h)} failed · ${num(stats.pending)} retrying` : stats.pending ? `${num(stats.pending)} waiting to retry` : "All delivered"}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Quickstart</CardTitle>
          <CardDescription>Three steps from zero to &ldquo;text every new lead&rdquo;. Nothing here changes your data.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-4 lg:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-bg-subtle/60 p-4">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-caption font-semibold text-brand-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <h3 className="text-body font-medium">{s.title}</h3>
                </div>
                <p className="text-ui text-pretty text-muted-foreground">{s.text}</p>
                {s.code ? <Snippet label="Terminal" code={s.code} /> : null}
                {s.action ? (
                  <Button variant="outline" size="sm" className="mt-auto h-9 w-fit sm:h-8" render={<Link href={s.action.href} />}>
                    {s.action.label}
                    <ArrowRightIcon aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>Send the key as <code translate="no">Authorization: Bearer al_…</code>. Limits: 300 requests a minute per route.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-caption font-medium text-muted-foreground">REST base URL</div>
              <CopyField value={`${origin}/api/v1`} />
            </div>
            <div className="space-y-1.5">
              <div className="text-caption font-medium text-muted-foreground">OpenAPI 3.1 spec (Postman, Insomnia, SDK generators)</div>
              <CopyField value={`${origin}/api/v1/openapi.json`} />
            </div>
            <div className="space-y-1.5">
              <div className="text-caption font-medium text-muted-foreground">MCP server (Claude, Cursor and other AI agents)</div>
              <CopyField value={`${origin}/api/mcp`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook events</CardTitle>
            <CardDescription>Signed with HMAC-SHA256, retried for about two days, logged for 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {WEBHOOK_EVENTS.map((e) => (
                <li key={e.type} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
                  <code translate="no" className="font-mono text-mono text-foreground">
                    {e.type}
                  </code>
                  <span className="text-ui text-pretty text-muted-foreground">{e.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <nav aria-label="Documentation" className="flex flex-wrap gap-2">
        {[
          { href: `${DOCS}/API.md`, label: "REST API docs" },
          { href: `${DOCS}/WEBHOOKS.md`, label: "Webhooks guide" },
          { href: `${DOCS}/MCP.md`, label: "MCP server" },
        ].map((l) => (
          <Button key={l.href} variant="ghost" size="sm" className="h-9 text-muted-foreground sm:h-8" render={<a href={l.href} target="_blank" rel="noreferrer" />}>
            <BookOpenIcon aria-hidden />
            {l.label}
          </Button>
        ))}
      </nav>
    </>
  );
}
