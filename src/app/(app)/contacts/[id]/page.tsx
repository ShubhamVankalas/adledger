import { ActivityIcon, ArrowLeftIcon, PieChartIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactPrivacyActions } from "@/components/contact-privacy-actions";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CHANNEL_LABELS, MODEL_LABELS, money, num, pct } from "@/lib/format";
import { journey, type JourneyItem } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { ContactAvatar, leadSourceLabel, parseUrl, PLATFORM_LABELS, SourceValue, TimelineItem } from "./journey-parts";

export const metadata = { title: "Contact" };

function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

type Touch = Extract<JourneyItem, { kind: "touchpoint" }>;

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const j = await journey(db, ws, id);
  if (!j) notFound();
  const tz = ws.timezone;
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
    timeZone: tz,
  });
  const shortDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });

  const touches = j.items.filter((i): i is Touch => i.kind === "touchpoint");
  const payments = j.items.filter((i) => i.kind === "payment");
  const refunds = j.items.filter((i) => i.kind === "refund");
  const firstLead = j.items.find((i) => i.kind === "lead");
  const revenue = j.items.reduce((s, i) => (i.kind === "payment" || i.kind === "refund" ? s + i.amountMinor : s), 0);
  const firstTouch = touches[0];
  const firstPayment = payments[0];
  const lastAt = j.items.at(-1)?.at ?? j.contact.firstSeenAt;
  const start = new Date(firstTouch?.at ?? j.contact.firstSeenAt).getTime();
  const since = (at: string | undefined) => (at ? duration(Math.max(0, new Date(at).getTime() - start)) : null);

  // Group the timeline by calendar day (workspace timezone) so dates aren't repeated on every event.
  const days: { day: string; items: JourneyItem[] }[] = [];
  for (const i of j.items) {
    const day = dayFmt.format(new Date(i.at));
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1)!.items.push(i);
  }
  const byModel = Object.entries(
    j.credits.reduce<Record<string, { label: string; revenueMinor: number }[]>>((acc, c) => {
      (acc[c.model] ??= []).push(c);
      return acc;
    }, {}),
  );
  const sig = (items: { label: string; revenueMinor: number }[]) => items.map((x) => `${x.label}:${x.revenueMinor}`).join("|");
  // When every model splits the revenue the same way (e.g. a single campaign), show it once.
  const agree = byModel.length > 1 && byModel.every(([, items]) => sig(items) === sig(byModel[0][1]));
  const creditGroups: [string, { label: string; revenueMinor: number }[]][] = agree ? [["all", byModel[0][1]]] : byModel;
  const displayName = j.contact.name || j.contact.email || "Anonymous contact";
  const customer = j.contact.lifecycle === "customer";
  const devices = Math.max(1, j.contact.devices);
  const landing = parseUrl(firstTouch?.landingUrl ?? null);

  const stats: { label: string; value: React.ReactNode; tone?: string }[] = [
    {
      label: "Net revenue",
      value: money(revenue, ws.reportingCurrency),
      tone: revenue > 0 ? "text-success" : revenue < 0 ? "text-destructive" : undefined,
    },
    { label: "First touch", value: <SourceValue item={firstTouch} /> },
    {
      label: "First seen",
      value: shortDate.format(new Date(j.contact.firstSeenAt)),
    },
    { label: "Last activity", value: shortDate.format(new Date(lastAt)) },
    { label: "Touchpoints", value: num(touches.length) },
    { label: devices === 1 ? "Device" : "Devices", value: num(devices) },
  ];

  return (
    <>
      <PageHeader title={displayName} description={customer ? "Customer profile" : "Lead profile"}>
        <Button variant="ghost" size="sm" className="size-10 px-0 md:size-auto md:h-7 md:px-2.5" aria-label="All contacts" render={<Link href="/contacts" />}>
          <ArrowLeftIcon /> <span className="max-md:sr-only">All contacts</span>
        </Button>
        <ContactPrivacyActions
          contactId={j.contact.id}
          label={j.contact.name || j.contact.email || "this contact"}
          canExport={user.can("reports.export")}
          canDelete={user.can("workspace.data")}
        />
      </PageHeader>
      <PageBody>
        <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">
          {/* Profile header */}
          <Card className="overflow-hidden py-0">
            <div className="flex items-center gap-4 p-4 sm:p-6">
              <ContactAvatar id={j.contact.id} name={j.contact.name} email={j.contact.email} className="size-12 text-base sm:size-14 sm:text-lg" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 text-lg font-semibold tracking-tight text-balance break-words sm:text-xl">{displayName}</h2>
                  <Badge variant={customer ? "default" : "secondary"}>{customer ? "Customer" : "Lead"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {j.contact.name && j.contact.email ? <span className="break-all" translate="no">
                      {j.contact.email}
                    </span> : null}
                  {j.contact.name && j.contact.email ? <span aria-hidden> · </span> : null}
                  {customer && firstPayment
                    ? `Customer since ${shortDate.format(new Date(firstPayment.at))}`
                    : firstLead
                      ? `Lead since ${shortDate.format(new Date(firstLead.at))}`
                      : `First seen ${shortDate.format(new Date(j.contact.firstSeenAt))}`}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-3 xl:grid-cols-6">
              {stats.map((s) => (
                <div key={s.label} className="min-w-0 bg-card px-4 py-3 sm:px-6 sm:py-4">
                  <dt className="text-xs text-muted-foreground">{s.label}</dt>
                  <dd className={cn("tabular mt-1 truncate text-base font-semibold tracking-tight", s.tone)}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
            <Card>
              <CardHeader>
                <CardTitle>Journey</CardTitle>
                <CardDescription>
                  Every ad click, visit, form and payment, oldest first · times in {tz.replace(/_/g, " ")}
                  {devices > 1 ? ` · stitched across ${devices} devices` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {j.items.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ActivityIcon className="size-5" aria-hidden />
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">No activity recorded yet</p>
                      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                        Visits and ad clicks show up here once this person browses a site with the AdLedger pixel installed. Forms and payments are added as
                        they come in.
                      </p>
                    </div>
                    {user.can("workspace.settings") ? (
                      <Button variant="outline" size="sm" render={<Link href="/settings/workspace/tracking" />}>
                        Check tracking setup
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {days.map((d) => (
                      <section key={d.day} aria-label={d.day}>
                        <h3 className="mb-3 flex items-center gap-3 text-xs font-medium text-muted-foreground">
                          <span className="shrink-0">{d.day}</span>
                          <span aria-hidden className="h-px flex-1 bg-border" />
                        </h3>
                        <ol>
                          {d.items.map((i, idx) => (
                            <TimelineItem key={idx} item={i} time={timeFmt.format(new Date(i.at))} showDevice={devices > 1} last={idx === d.items.length - 1} />
                          ))}
                        </ol>
                      </section>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4 md:space-y-6 lg:sticky lg:top-24">
              <Card>
                <CardHeader>
                  <CardTitle>How they found you</CardTitle>
                  <CardDescription>The path from first click to revenue</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="divide-y text-sm">
                    <Fact label="First touch">
                      {firstTouch ? (
                        <span className="text-right">
                          {firstTouch.platform ? `${PLATFORM_LABELS[firstTouch.platform] ?? firstTouch.platform} · ` : ""}
                          {CHANNEL_LABELS[firstTouch.channel] ?? firstTouch.channel.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <Muted>Not tracked</Muted>
                      )}
                    </Fact>
                    {firstTouch?.campaign ? <Fact label="Campaign">{firstTouch.campaign}</Fact> : null}
                    {landing ? (
                      <Fact label="Landing page">
                        <span className="break-all" title={firstTouch?.landingUrl ?? undefined}>
                          {landing.path}
                        </span>
                      </Fact>
                    ) : null}
                    <Fact label="Became a lead">
                      {firstLead ? (
                        <span className="text-right">
                          {since(firstLead.at) ? `after ${since(firstLead.at)}` : ""}
                          <span className="block text-xs text-muted-foreground">via {leadSourceLabel(firstLead.kind === "lead" ? firstLead.source : "")}</span>
                        </span>
                      ) : (
                        <Muted>Not yet</Muted>
                      )}
                    </Fact>
                    <Fact label="First payment">{firstPayment ? <span>after {since(firstPayment.at)}</span> : <Muted>Not yet</Muted>}</Fact>
                    <Fact label="Payments">
                      <span className="tabular">
                        {num(payments.length)}
                        {refunds.length ? <span className="text-muted-foreground"> · {num(refunds.length)} refunded</span> : null}
                      </span>
                    </Fact>
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Who gets the credit?</CardTitle>
                  <CardDescription>How each attribution model splits this contact&rsquo;s revenue</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {byModel.length === 0 ? (
                    <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                      <PieChartIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="space-y-1.5 text-sm">
                        <p className="font-medium">No revenue to split yet</p>
                        <p className="text-muted-foreground">When a payment is matched to this contact, each model shows which campaigns earn the credit.</p>
                      </div>
                    </div>
                  ) : null}
                  {creditGroups.map(([model, items]) => {
                    const total = items.reduce((s, x) => s + Math.abs(x.revenueMinor), 0) || 1;
                    return (
                      <div key={model} className="space-y-2.5">
                        <div className="text-xs font-medium text-muted-foreground">
                          {model === "all" ? "Every model agrees" : (MODEL_LABELS[model] ?? model)}
                        </div>
                        {items.map((x) => {
                          const share = Math.abs(x.revenueMinor) / total;
                          return (
                            <div key={x.label} className="space-y-1.5">
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate" title={x.label}>
                                  {x.label}
                                </span>
                                <span className="tabular shrink-0 font-medium">
                                  {money(x.revenueMinor, ws.reportingCurrency)}
                                  <span className="ml-1.5 inline-block w-9 text-right text-xs font-normal text-muted-foreground">{pct(share, 0)}</span>
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className={cn("h-full rounded-full", x.revenueMinor < 0 ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.round(share * 100)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}
