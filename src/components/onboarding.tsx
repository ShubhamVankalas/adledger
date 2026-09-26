import { sql } from "drizzle-orm";
import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { getLlmConfig } from "@/lib/ai/report";
import { rows, type DB } from "@/lib/db";
import type { Workspace } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

export type SetupStep = { key: string; done: boolean; optional?: boolean; label: string; desc: string; href: string };
export type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;

export async function getSetupStatus(db: DB, ws: Workspace) {
  const [r] = rows<Record<string, string | boolean | null>>(
    await db.execute(sql`select
      exists(select 1 from pixel_sites where workspace_id = ${ws.id}) has_site,
      (select max(occurred_at) from events where workspace_id = ${ws.id}) last_event,
      exists(select 1 from leads where workspace_id = ${ws.id}) has_lead,
      exists(select 1 from connections where workspace_id = ${ws.id} and enabled and provider in
        ('stripe','shopify','woocommerce','paddle','lemonsqueezy','razorpay','paypal')) has_revenue_conn,
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

/** Compact banner for the Overview page. On phones only the next step keeps its description. */
export function Onboarding({ status }: { status: SetupStatus }) {
  const next = status.steps.find((s) => !s.done && !s.optional) ?? status.steps.find((s) => !s.done);
  const required = status.steps.filter((s) => !s.optional);
  return (
    <Card className="ring-primary/25">
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          <span className="tabular">
            {status.done} of {status.steps.length} done.
          </span>{" "}
          <span className="max-sm:hidden">Numbers get accurate once the pixel, payments and ad spend are all connected.</span>
        </CardDescription>
        <CardAction>
          <Link
            href="/onboarding"
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/10 sm:h-7"
          >
            <span className="sm:hidden">Checklist</span>
            <span className="max-sm:hidden">Open setup checklist</span>
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={(status.done / status.steps.length) * 100} aria-label="Setup progress" />
        <ol className="grid gap-1.5 sm:grid-cols-2 sm:gap-2 xl:grid-cols-4">
          {required.map((s) => {
            const isNext = next?.key === s.key;
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  aria-current={isNext ? "step" : undefined}
                  className={cn(
                    "flex h-full min-h-11 flex-col justify-center rounded-lg border px-3 py-2 transition-colors hover:border-primary/40 hover:bg-accent/40 sm:p-3",
                    s.done && "opacity-60",
                    isNext && "border-primary/50 bg-primary/5",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {s.done ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : <CircleIcon className={cn("size-4 shrink-0", isNext ? "text-primary" : "text-muted-foreground")} />}
                    <span className={cn(s.done && "line-through decoration-muted-foreground/40")}>{s.label}</span>
                    {isNext ? <ArrowRightIcon className="ml-auto size-3.5 shrink-0 text-primary sm:hidden" /> : null}
                  </span>
                  <span className={cn("mt-1 pl-6 text-xs text-muted-foreground sm:block", isNext ? "block" : "hidden")}>{s.desc}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
