import { ArrowLeftIcon, BadgeDollarSignIcon, FileTextIcon, MousePointerClickIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactPrivacyActions } from "@/components/contact-privacy-actions";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CHANNEL_LABELS, MODEL_LABELS, money } from "@/lib/format";
import { journey, type JourneyItem } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contact journey" };

function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

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
    weekday: "short",
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
  const revenue = j.items.reduce((s, i) => (i.kind === "payment" || i.kind === "refund" ? s + i.amountMinor : s), 0);
  const touchpoints = j.items.filter((i) => i.kind === "touchpoint").length;
  const firstTouch = j.items.find((i) => i.kind === "touchpoint");
  const firstPayment = j.items.find((i) => i.kind === "payment");
  const toPurchase = firstTouch && firstPayment ? new Date(firstPayment.at).getTime() - new Date(firstTouch.at).getTime() : null;
  const byModel = Object.entries(
    j.credits.reduce<Record<string, { label: string; revenueMinor: number }[]>>((acc, c) => {
      (acc[c.model] ??= []).push(c);
      return acc;
    }, {}),
  );
  // Group the timeline by calendar day (in the workspace timezone) so dates aren't repeated on every event.
  const days: { day: string; items: JourneyItem[] }[] = [];
  for (const i of j.items) {
    const day = dayFmt.format(new Date(i.at));
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1)!.items.push(i);
  }
  const displayName = j.contact.name || j.contact.email || "Anonymous contact";
  const customer = j.contact.lifecycle === "customer";

  return (
    <>
      <PageHeader title={displayName} description={j.contact.name ? (j.contact.email ?? undefined) : undefined}>
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
        <div className="mx-auto grid max-w-6xl items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-[auto_1fr]">
          {/* Summary first on phones; right column on desktop. */}
          <Card className="lg:col-start-2 lg:row-start-1">
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-full text-base font-semibold",
                    customer ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{displayName}</div>
                  {j.contact.name && j.contact.email ? <div className="text-xs break-all text-muted-foreground">{j.contact.email}</div> : null}
                </div>
                <Badge className="ml-auto capitalize" variant={customer ? "default" : "secondary"}>
                  {j.contact.lifecycle}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm">
                <Stat
                  label="Net revenue"
                  value={money(revenue, ws.reportingCurrency)}
                  tone={revenue > 0 ? "text-success" : revenue < 0 ? "text-destructive" : undefined}
                />
                <Stat label="Touchpoints" value={String(touchpoints)} />
                <Stat label="First seen" value={shortDate.format(new Date(j.contact.firstSeenAt))} />
                <Stat label={toPurchase !== null ? "Time to purchase" : "Devices"} value={toPurchase !== null ? duration(toPurchase) : String(j.contact.devices || 1)} />
              </dl>
            </CardContent>
          </Card>

          <Card className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <CardHeader>
              <CardTitle>Journey</CardTitle>
              <CardDescription>
                Every tracked touchpoint, form submission and payment · times in {tz}
                {j.contact.devices > 1 ? ` · stitched across ${j.contact.devices} devices` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {j.items.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No activity recorded for this contact yet.</p>
              ) : (
                <div className="space-y-6">
                  {days.map((d) => (
                    <section key={d.day} aria-label={d.day}>
                      <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{d.day}</h3>
                      <ol className="ml-3.5 space-y-5 border-l border-border pl-7">
                        {d.items.map((i, idx) => (
                          <TimelineItem key={idx} item={i} time={timeFmt.format(new Date(i.at))} showDevice={j.contact.devices > 1} />
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-start-2 lg:row-start-2">
            <CardHeader>
              <CardTitle>Who gets the credit?</CardTitle>
              <CardDescription>How each attribution model splits this contact&apos;s revenue</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {byModel.length === 0 ? <p className="text-sm text-muted-foreground">No revenue yet — credit is assigned once this contact pays.</p> : null}
              {byModel.map(([model, items]) => {
                const total = items.reduce((s, x) => s + Math.abs(x.revenueMinor), 0) || 1;
                return (
                  <div key={model} className="space-y-2">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{MODEL_LABELS[model] ?? model}</div>
                    {items.map((x) => (
                      <div key={x.label} className="space-y-1">
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate" title={x.label}>
                            {x.label}
                          </span>
                          <span className="tabular shrink-0 font-medium">{money(x.revenueMinor, ws.reportingCurrency)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", x.revenueMinor < 0 ? "bg-destructive" : "bg-primary")}
                            style={{
                              width: `${(Math.abs(x.revenueMinor) / total) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular mt-0.5 truncate font-semibold", tone)}>{value}</dd>
    </div>
  );
}

function TimelineItem({ item: i, time, showDevice }: { item: JourneyItem; time: string; showDevice: boolean }) {
  const Icon = i.kind === "touchpoint" ? MousePointerClickIcon : i.kind === "lead" ? FileTextIcon : i.kind === "payment" ? BadgeDollarSignIcon : Undo2Icon;
  const tone =
    i.kind === "payment"
      ? "bg-success text-white"
      : i.kind === "refund"
        ? "bg-destructive text-white"
        : i.kind === "lead"
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-muted-foreground";
  return (
    <li className="relative">
      <span className={cn("absolute top-0 -left-[42.5px] flex size-7 items-center justify-center rounded-full ring-4 ring-card", tone)} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <time className="tabular">{time}</time>
        {showDevice && i.kind === "touchpoint" ? <span>· device {i.device}</span> : null}
      </div>
      {i.kind === "touchpoint" ? (
        <div className="mt-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {i.platform ? <PlatformBadge platform={i.platform} /> : null}
            <span className="min-w-0 break-words">{i.campaign ?? CHANNEL_LABELS[i.channel] ?? i.channel}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {CHANNEL_LABELS[i.channel] ?? i.channel}
            {i.adGroup ? ` · ${i.adGroup}` : ""}
            {i.ad ? ` › ${i.ad}` : ""}
          </div>
          {i.landingUrl ? (
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={i.landingUrl}>
              {i.landingUrl.replace(/^https?:\/\//, "")}
            </div>
          ) : null}
        </div>
      ) : i.kind === "lead" ? (
        <div className="mt-1 text-sm font-medium">
          Became a lead{i.formName ? ` · ${i.formName}` : ""}{" "}
          <span className="font-normal text-muted-foreground">via {i.source === "pixel" ? "website form" : "webhook"}</span>
        </div>
      ) : (
        <div className={cn("tabular mt-1 text-sm font-semibold", i.kind === "refund" ? "text-destructive" : "text-success")}>
          {i.kind === "payment" ? "Paid " : "Refunded "}
          {money(Math.abs(i.amountMinor), i.currency)}
        </div>
      )}
    </li>
  );
}
