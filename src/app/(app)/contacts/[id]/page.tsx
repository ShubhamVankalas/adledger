import { ArrowLeftIcon, BadgeDollarSignIcon, FileTextIcon, MousePointerClickIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody, PageHeader } from "@/components/page-header";
import { PlatformBadge } from "@/components/platform-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CHANNEL_LABELS, MODEL_LABELS, money } from "@/lib/format";
import { journey } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Contact journey" };

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const j = await journey(db, ws, id);
  if (!j) notFound();
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: ws.timezone });
  const revenue = j.items.reduce((s, i) => (i.kind === "payment" || i.kind === "refund" ? s + i.amountMinor : s), 0);
  const byModel = Object.entries(
    j.credits.reduce<Record<string, { label: string; revenueMinor: number }[]>>((acc, c) => {
      (acc[c.model] ??= []).push(c);
      return acc;
    }, {}),
  );

  return (
    <>
      <PageHeader title={j.contact.name || j.contact.email || "Contact"} description={j.contact.name ? (j.contact.email ?? undefined) : undefined}>
        <Button variant="ghost" size="sm" render={<Link href="/contacts" />}>
          <ArrowLeftIcon /> All contacts
        </Button>
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Journey</CardTitle>
              <CardDescription>
                Every tracked touchpoint, form submission and payment · times in {ws.timezone}
                {j.contact.devices > 1 ? ` · stitched across ${j.contact.devices} devices` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {j.items.length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : null}
              <ol className="relative space-y-5 border-l border-border pl-6">
                {j.items.map((i, idx) => {
                  const icon =
                    i.kind === "touchpoint" ? MousePointerClickIcon : i.kind === "lead" ? FileTextIcon : i.kind === "payment" ? BadgeDollarSignIcon : Undo2Icon;
                  const Icon = icon;
                  const tone =
                    i.kind === "payment" ? "bg-success text-white" : i.kind === "refund" ? "bg-destructive text-white" : i.kind === "lead" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground";
                  return (
                    <li key={idx} className="relative">
                      <span className={cn("absolute top-0 -left-[2.1rem] flex size-6 items-center justify-center rounded-full ring-4 ring-card", tone)}>
                        <Icon className="size-3" />
                      </span>
                      <div className="text-xs text-muted-foreground">{fmt.format(new Date(i.at))}</div>
                      {i.kind === "touchpoint" ? (
                        <div className="mt-0.5 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {i.platform ? <PlatformBadge platform={i.platform} /> : null}
                            {i.campaign ?? CHANNEL_LABELS[i.channel] ?? i.channel}
                            <Badge variant="outline" className="font-normal">
                              {CHANNEL_LABELS[i.channel] ?? i.channel}
                            </Badge>
                            {j.contact.devices > 1 ? <span className="text-xs font-normal text-muted-foreground">device {i.device}</span> : null}
                          </div>
                          {i.ad || i.adGroup ? (
                            <div className="text-xs text-muted-foreground">
                              {i.adGroup}
                              {i.ad ? ` › ${i.ad}` : ""}
                            </div>
                          ) : null}
                          {i.landingUrl ? <div className="truncate font-mono text-[11px] text-muted-foreground">{i.landingUrl.replace(/^https?:\/\//, "").slice(0, 110)}</div> : null}
                        </div>
                      ) : i.kind === "lead" ? (
                        <div className="mt-0.5 text-sm font-medium">
                          Became a lead{i.formName ? ` · ${i.formName}` : ""}{" "}
                          <span className="font-normal text-muted-foreground">via {i.source === "pixel" ? "website form" : "webhook"}</span>
                        </div>
                      ) : (
                        <div className={cn("tabular mt-0.5 text-sm font-semibold", i.kind === "refund" ? "text-destructive" : "text-success")}>
                          {i.kind === "payment" ? "Paid " : "Refunded "}
                          {money(Math.abs(i.amountMinor), i.currency)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <Badge className="mt-1" variant={j.contact.lifecycle === "customer" ? "default" : "secondary"}>
                    {j.contact.lifecycle}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Net revenue</div>
                  <div className="tabular mt-1 font-semibold">{money(revenue, ws.reportingCurrency)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Touchpoints</div>
                  <div className="tabular mt-1 font-semibold">{j.items.filter((i) => i.kind === "touchpoint").length}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">First seen</div>
                  <div className="mt-1 font-semibold">{new Date(j.contact.firstSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ws.timezone })}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who gets the credit?</CardTitle>
                <CardDescription>How each attribution model splits this contact&apos;s revenue</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {byModel.length === 0 ? <p className="text-sm text-muted-foreground">No revenue yet.</p> : null}
                {byModel.map(([model, items]) => {
                  const total = items.reduce((s, x) => s + Math.abs(x.revenueMinor), 0) || 1;
                  return (
                    <div key={model} className="space-y-1.5">
                      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{MODEL_LABELS[model]}</div>
                      {items.map((x) => (
                        <div key={x.label} className="space-y-1">
                          <div className="flex justify-between gap-2 text-sm">
                            <span className="truncate">{x.label}</span>
                            <span className="tabular shrink-0 font-medium">{money(x.revenueMinor, ws.reportingCurrency)}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(Math.abs(x.revenueMinor) / total) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
