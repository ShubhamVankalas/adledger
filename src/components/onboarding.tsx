import { sql } from "drizzle-orm";
import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { getLlmConfig } from "@/lib/ai/report";
import { rows, type DB } from "@/lib/db";
import type { Workspace } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
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

/** Compact banner for the Overview page. */
export function Onboarding({ status }: { status: SetupStatus }) {
  const next = status.steps.find((s) => !s.done && !s.optional) ?? status.steps.find((s) => !s.done);
  return (
    <Card className="border-primary/25">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Finish setting up</CardTitle>
          <CardDescription>
            {status.done} of {status.steps.length} done. Numbers get accurate once the pixel, payments and ad spend are all connected.
          </CardDescription>
        </div>
        <Link href="/onboarding" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open setup checklist <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress aria-label="Setup progress" value={(status.done / status.steps.length) * 100} />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {status.steps
            .filter((s) => !s.optional)
            .map((s) => (
              <Link
                key={s.key}
                href={s.href}
                className={cn("rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40", s.done && "opacity-60", next?.key === s.key && "border-primary/50 bg-primary/5")}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.done ? <CheckCircle2Icon className="size-4 text-success" /> : <CircleIcon className="size-4 text-muted-foreground" />}
                  {s.label}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
              </Link>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
