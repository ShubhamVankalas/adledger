import { ChevronRightIcon, ShieldAlertIcon, WebhookIcon } from "lucide-react";
import Link from "next/link";
import { AccessDenied, gatePage } from "@/components/access-denied";
import { CreateEndpointDialog } from "@/components/developers/webhook-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { num, timeAgo } from "@/lib/format";
import { MAX_ATTEMPTS, webhookEventLabel } from "@/lib/webhooks/catalog";
import { listEndpoints, MAX_ENDPOINTS } from "@/lib/webhooks/endpoints";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  if (!user.can("developers.access")) return <AccessDenied user={user} />;
  const endpoints = await listEndpoints(await getDb(), user.workspace.id);
  const canPii = user.can("contacts.pii");
  const full = endpoints.length >= MAX_ENDPOINTS;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Webhook endpoints</CardTitle>
          <CardDescription className="max-w-2xl text-pretty">
            Real-time events for your own tools. Each request is signed, answered within 10 seconds or retried up to {MAX_ATTEMPTS} times over about two days.
          </CardDescription>
        </div>
        <CreateEndpointDialog canPii={canPii} disabled={full} />
      </CardHeader>
      <CardContent className={endpoints.length ? "-mb-(--card-spacing) px-0" : undefined}>
        {endpoints.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WebhookIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No endpoints yet</EmptyTitle>
              <EmptyDescription className="text-pretty">
                Add a URL from Zapier, Make, n8n or your own server and pick the events it should get, like a new lead or a payment.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link href="/developers/recipes" className="text-ui text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Browse recipes
              </Link>
            </EmptyContent>
          </Empty>
        ) : (
          <ul className="divide-y border-t">
            {endpoints.map((e) => {
              const attempted = e.delivered24h + e.failed24h;
              return (
                <li key={e.id}>
                  <Link
                    href={`/developers/webhooks/${e.id}`}
                    className="group grid gap-2 px-4 py-3.5 transition-colors outline-none hover:bg-fill/60 focus-visible:bg-fill/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_14rem_1rem] md:items-center md:gap-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-mono text-foreground" translate="no" title={e.url}>
                          {e.url}
                        </span>
                        {e.enabled ? <Badge variant="positive">Active</Badge> : <Badge variant="outline">Paused</Badge>}
                        {e.includePii ? (
                          <Badge variant="warning">
                            <ShieldAlertIcon aria-hidden /> Personal data
                          </Badge>
                        ) : null}
                      </div>
                      {e.description ? <p className="truncate text-ui text-muted-foreground">{e.description}</p> : null}
                      <p className="truncate text-caption text-muted-foreground">
                        {e.events.length === 1 ? webhookEventLabel(e.events[0]) : `${e.events.length} events: ${e.events.join(", ")}`}
                      </p>
                    </div>
                    <div className="text-caption text-muted-foreground md:text-right">
                      {attempted === 0 && !e.pending ? (
                        <span>No deliveries in 24 h</span>
                      ) : (
                        <span>
                          <span className="font-medium text-foreground tabular-nums">{num(e.delivered24h)}</span> delivered
                          {e.failed24h ? (
                            <>
                              {" · "}
                              <span className="font-medium text-negative tabular-nums">{num(e.failed24h)}</span> failed
                            </>
                          ) : null}
                          {e.pending ? <> · {num(e.pending)} queued</> : null}
                        </span>
                      )}
                      <span className="block" suppressHydrationWarning>
                        {e.lastDeliveryAt ? `Last sent ${timeAgo(e.lastDeliveryAt)}` : `Added ${timeAgo(e.createdAt)}`}
                      </span>
                    </div>
                    <ChevronRightIcon aria-hidden className="hidden size-4 text-fg-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none md:block" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
