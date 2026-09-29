import { and, eq, sql } from "drizzle-orm";
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied, gatePage } from "@/components/access-denied";
import { DeleteEndpointButton, DeliveryLog, EndpointEnabledSwitch, SendTestEvent, SigningSecret, StatusFilter } from "@/components/developers/webhook-endpoint";
import { EditEndpointForm } from "@/components/developers/webhook-forms";
import { Snippet } from "@/components/settings/code-snippet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { UUID_RE } from "@/lib/request-auth";
import { DELIVERY_RETENTION_DAYS } from "@/lib/webhooks/catalog";
import { getEndpoint, listDeliveries } from "@/lib/webhooks/endpoints";
import { VERIFY_NODE, VERIFY_PYTHON } from "@/lib/webhooks/snippets";

export const metadata = { title: "Webhook endpoint" };

const STATUSES = ["delivered", "failed", "pending"] as const;

export default async function WebhookEndpointPage({ params, searchParams }: PageProps<"/developers/webhooks/[id]">) {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  if (!user.can("developers.access")) return <AccessDenied user={user} />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const db = await getDb();
  const ep = await getEndpoint(db, user.workspace.id, id);
  if (!ep) notFound();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const d = schema.webhookDeliveries;
  const [rows, counts] = await Promise.all([
    listDeliveries(db, user.workspace.id, ep.id, { status, limit: 100 }),
    db
      .select({ status: d.status, n: sql<number>`count(*)::int` })
      .from(d)
      .where(and(eq(d.workspaceId, user.workspace.id), eq(d.endpointId, ep.id)))
      .groupBy(d.status),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const total = counts.reduce((n, c) => n + c.n, 0);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <Link href="/developers/webhooks" className="inline-flex items-center gap-1 rounded-sm text-ui text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <ArrowLeftIcon aria-hidden className="size-3.5" /> All endpoints
          </Link>
          <h2 className="font-mono text-body font-medium break-all text-foreground" translate="no">
            {ep.url}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {ep.enabled ? <Badge variant="positive">Active</Badge> : <Badge variant="outline">Paused</Badge>}
            {ep.includePii ? (
              <Badge variant="warning">
                <ShieldAlertIcon aria-hidden /> Sends personal data
              </Badge>
            ) : (
              <Badge variant="secondary">Emails masked</Badge>
            )}
            {ep.description ? <span className="text-ui text-muted-foreground">{ep.description}</span> : null}
          </div>
        </div>
        <EndpointEnabledSwitch id={ep.id} enabled={ep.enabled} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Deliveries</CardTitle>
              <CardDescription>
                Newest first, kept for {DELIVERY_RETENTION_DAYS} days. Open a row for the payload and your endpoint&rsquo;s response.
              </CardDescription>
            </div>
            <StatusFilter current={status ?? "all"} counts={{ all: total, failed: count("failed"), pending: count("pending"), delivered: count("delivered") }} />
          </CardHeader>
          <CardContent className={rows.length ? "-mb-(--card-spacing) px-0" : undefined}>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-8 text-center text-ui text-pretty text-muted-foreground">
                {status ? "Nothing with this status." : "Nothing sent yet. Send a test event, or wait for the next lead or payment."}
              </p>
            ) : (
              <DeliveryLog
                canResend={ep.enabled}
                rows={rows.map((r) => ({
                  id: r.id,
                  event: r.event,
                  eventId: r.eventId,
                  status: r.status,
                  attempts: r.attempts,
                  maxAttempts: r.maxAttempts,
                  responseCode: r.responseCode,
                  responseBody: r.responseBody,
                  lastError: r.lastError,
                  durationMs: r.durationMs,
                  createdAt: r.createdAt.toISOString(),
                  nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
                  test: r.payload.test === true,
                  payload: JSON.stringify(r.payload, null, 2),
                }))}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Send a test event</CardTitle>
              <CardDescription>Check your receiver end to end before real leads arrive.</CardDescription>
            </CardHeader>
            <CardContent>
              <SendTestEvent id={ep.id} events={ep.events} disabled={!ep.enabled} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Signing secret</CardTitle>
              <CardDescription>Verify the AdLedger-Signature header with it so nobody else can post fake events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SigningSecret id={ep.id} />
              <details className="group rounded-lg border">
                <summary className="cursor-pointer rounded-lg px-3 py-2 text-ui font-medium outline-none hover:bg-fill/60 focus-visible:ring-3 focus-visible:ring-ring/50">
                  Verification code
                </summary>
                <div className="grid gap-2 border-t p-2">
                  <Snippet label="Node.js" code={VERIFY_NODE} />
                  <Snippet label="Python" code={VERIFY_PYTHON} />
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Changes apply to new events. Events already queued keep the data they were created with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <EditEndpointForm id={ep.id} canPii={user.can("contacts.pii")} initial={{ url: ep.url, description: ep.description, events: ep.events, includePii: ep.includePii }} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-ui text-muted-foreground">Deleting removes the endpoint and its delivery log. Nothing else changes.</p>
            <DeleteEndpointButton id={ep.id} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
