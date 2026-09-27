import { sql } from "drizzle-orm";
import { ArrowRightIcon, BarChart3Icon, CheckCircle2Icon, CircleIcon, RouteIcon, SparklesIcon, TrendingUpIcon } from "lucide-react";
import Link from "next/link";
import { getLlmConfig } from "@/lib/ai/report";
import { allIntegrations } from "@/lib/connectors/registry";
import { rows, type DB } from "@/lib/db";
import type { Workspace } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Progress } from "./ui/progress";

export type SetupStep = { key: string; done: boolean; optional?: boolean; label: string; desc: string; href: string };
export type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;

export async function getSetupStatus(db: DB, ws: Workspace) {
  // Every payment/CRM integration in the registry counts, so newly added connectors tick the step too.
  const REVENUE_PROVIDERS = allIntegrations()
    .filter((i) => i.category === "revenue")
    .map((i) => i.provider);
  const [r] = rows<Record<string, string | boolean | null>>(
    await db.execute(sql`select
      exists(select 1 from pixel_sites where workspace_id = ${ws.id}) has_site,
      (select max(occurred_at) from events where workspace_id = ${ws.id}) last_event,
      exists(select 1 from leads where workspace_id = ${ws.id}) has_lead,
      exists(select 1 from connections where workspace_id = ${ws.id} and enabled and provider in (${sql.join(
        REVENUE_PROVIDERS.map((p) => sql`${p}`),
        sql`, `,
      )})) has_revenue_conn,
      exists(select 1 from revenue_events where workspace_id = ${ws.id}) has_payment,
      exists(select 1 from connections where workspace_id = ${ws.id} and enabled and (provider = 'meta' or provider like '%_ads')) has_ads_conn,
      exists(select 1 from ad_insights_daily where workspace_id = ${ws.id}) has_spend,
      exists(select 1 from connections where workspace_id = ${ws.id} and provider like 'notify_%') has_notify,
      exists(select 1 from notification_rules where workspace_id = ${ws.id}) has_rules,
      (select count(*) from memberships where organization_id = ${ws.organizationId}) > 1 has_team,
      exists(select 1 from api_keys where workspace_id = ${ws.id} and revoked_at is null) has_key`),
  );
  const llm = await getLlmConfig(ws, db);
  const steps: SetupStep[] = [
    { key: "pixel", done: Boolean(r.has_site && r.last_event), label: "Install the tracking pixel", desc: "One script tag records visits, UTMs and ad click IDs.", href: "/onboarding#pixel" },
    { key: "leads", done: Boolean(r.has_lead), label: "Capture your first lead", desc: "Tag a form, call adledger.lead(), or connect a form tool.", href: "/onboarding#leads" },
    { key: "revenue", done: Boolean(r.has_revenue_conn || r.has_payment), label: "Connect payments", desc: "Stripe, Shopify, WooCommerce, Paddle, PayPal… or CSV / API.", href: "/onboarding#revenue" },
    { key: "ads", done: Boolean(r.has_ads_conn || r.has_spend), label: "Connect ad platforms", desc: "Meta, Google, TikTok, LinkedIn, Microsoft and more.", href: "/onboarding#ads" },
    { key: "notify", done: Boolean(r.has_notify && r.has_rules), optional: true, label: "Get alerts", desc: "Weekly report and wasted-spend alerts by email or Slack.", href: "/settings/workspace/notifications" },
    { key: "team", done: Boolean(r.has_team), optional: true, label: "Invite your team", desc: "Teammates, or clients with read-only access.", href: "/settings/organization/members" },
    { key: "ai", done: Boolean(llm), optional: true, label: "Choose an AI model", desc: "Ollama, OpenAI, Anthropic, Gemini… or skip it.", href: "/settings/workspace/ai" },
    { key: "mcp", done: Boolean(r.has_key), optional: true, label: "Ask Claude about your ads", desc: "Create an API key and add the MCP server.", href: "/settings/workspace/api" },
  ];
  const done = steps.filter((s) => s.done).length;
  const required = steps.filter((s) => !s.optional);
  return {
    steps,
    done,
    lastEventAt: r.last_event ? new Date(r.last_event as string).toISOString() : null,
    complete: required.every((s) => s.done),
  };
}

/** True when none of the essential steps are done yet: nothing to report, so pages show a welcome instead of zeros. */
export function isFreshWorkspace(status: SetupStatus) {
  return status.steps.every((s) => s.optional || !s.done);
}

/** Compact banner for the Overview page. On phones only the next step keeps its description. */
export function Onboarding({ status, canSetup = true }: { status: SetupStatus; canSetup?: boolean }) {
  const required = status.steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const next = required.find((s) => !s.done) ?? status.steps.find((s) => !s.done);
  return (
    <Card className="ring-primary/25">
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          <span className="tabular">
            {requiredDone} of {required.length} essentials done.
          </span>{" "}
          <span className="max-sm:hidden">Numbers get accurate once the pixel, payments and ad spend are all connected.</span>
        </CardDescription>
        {canSetup ? (
          <CardAction>
            <Link
              href="/onboarding"
              className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/10 sm:h-7"
            >
              <span className="sm:hidden">Checklist</span>
              <span className="max-sm:hidden">Open setup checklist</span>
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={(requiredDone / required.length) * 100} aria-label="Setup progress" />
        <ol className="grid gap-1.5 sm:grid-cols-2 sm:gap-2 xl:grid-cols-4">
          {required.map((s) => {
            const isNext = next?.key === s.key;
            const body = (
              <>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.done ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : <CircleIcon className={cn("size-4 shrink-0", isNext ? "text-primary" : "text-muted-foreground")} />}
                  <span className={cn("min-w-0", s.done && "line-through decoration-muted-foreground/40")}>{s.label}</span>
                  {isNext && canSetup ? <ArrowRightIcon className="ml-auto size-3.5 shrink-0 text-primary sm:hidden" /> : null}
                </span>
                <span className={cn("mt-1 pl-6 text-xs text-muted-foreground sm:block", isNext ? "block" : "hidden")}>{s.desc}</span>
              </>
            );
            const cls = cn(
              "flex h-full min-h-11 flex-col justify-center rounded-lg border px-3 py-2 sm:p-3",
              s.done && "opacity-60",
              isNext && "border-primary/50 bg-primary/5",
            );
            return (
              <li key={s.key}>
                {canSetup ? (
                  <Link href={s.href} aria-current={isNext ? "step" : undefined} className={cn(cls, "transition-colors hover:border-primary/40 hover:bg-accent/40")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Performance page on a workspace with no ad platform connected and no spend imported. */
export function NoAdDataYet({ canSetup }: { canSetup: boolean }) {
  return (
    <Empty className="border bg-card py-10 sm:py-14">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon" className="size-10 rounded-xl bg-primary/10 text-primary">
          <BarChart3Icon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">No ad data yet</EmptyTitle>
        <EmptyDescription>
          Connect Meta, Google, TikTok, LinkedIn or another ad platform to see spend, leads, customers and revenue for every campaign, ad set and ad.
          {canSetup ? null : " Ask an owner or admin to connect one."}
        </EmptyDescription>
      </EmptyHeader>
      {canSetup ? (
        <EmptyContent className="max-w-md sm:flex-row sm:justify-center">
          <Button size="lg" className="h-11 w-full px-4 sm:h-10 sm:w-auto" render={<Link href="/onboarding#ads" />}>
            Connect an ad platform <ArrowRightIcon />
          </Button>
          <Button size="lg" variant="outline" className="h-11 w-full px-4 sm:h-10 sm:w-auto" render={<Link href="/settings/workspace/import" />}>
            Import spend from CSV
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

const PREVIEW = [
  { icon: TrendingUpIcon, title: "ROAS per campaign, ad set and ad", body: "Real revenue from Stripe or your store, matched to the ad that brought each customer in." },
  { icon: RouteIcon, title: "Every customer's journey", body: "The clicks, visits and forms that led to each lead and sale, across every ad platform." },
  { icon: SparklesIcon, title: "Weekly insights", body: "What changed, what's wasting money, and what to scale — from your own AI model, or none." },
];

/** Replaces the dashboard on a brand-new workspace, where every number would be zero. */
export function Welcome({ status, name, canSetup }: { status: SetupStatus; name: string; canSetup: boolean }) {
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden ring-primary/25">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <CardHeader className="relative">
          <CardTitle className="text-lg break-words sm:text-xl">Let&apos;s get {name} tracking</CardTitle>
          <CardDescription className="max-w-2xl">
            {canSetup
              ? "Your dashboard fills in as soon as data arrives. Four steps, about 15 minutes — and you can do them in any order."
              : "An admin is still connecting this workspace. Your dashboard fills in as soon as data arrives."}
          </CardDescription>
        </CardHeader>
        <CardContent className="relative space-y-5">
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {status.steps
              .filter((s) => !s.optional)
              .map((s, i) => {
                const body = (
                  <>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{s.label}</div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                    </div>
                  </>
                );
                return (
                  <li key={s.key}>
                    {canSetup ? (
                      <Link href={s.href} className="flex h-full gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex h-full gap-3 rounded-lg border bg-card p-3">{body}</div>
                    )}
                  </li>
                );
              })}
          </ol>
          {canSetup ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button size="lg" className="h-11 px-4 text-[0.95rem] sm:h-10 sm:text-sm" render={<Link href="/onboarding" />}>
                Start the setup checklist <ArrowRightIcon />
              </Button>
              <Button size="lg" variant="ghost" className="h-11 px-4 sm:h-10" render={<Link href="/settings/workspace/integrations" />}>
                Browse integrations
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section aria-labelledby="preview-heading" className="space-y-3">
        <h2 id="preview-heading" className="text-sm font-medium text-muted-foreground">
          What you&apos;ll see here
        </h2>
        <div className="grid gap-3 xl:grid-cols-3">
          {PREVIEW.map((p) => (
            <div key={p.title} className="flex gap-3 rounded-xl border border-dashed p-4 xl:flex-col xl:gap-0">
              <p.icon className="mt-0.5 size-5 shrink-0 text-primary xl:mt-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium xl:mt-3">{p.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
