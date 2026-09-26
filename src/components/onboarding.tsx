import { sql } from "drizzle-orm";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { getLlmConfig } from "@/lib/ai/report";
import { rows, type DB } from "@/lib/db";
import type { Workspace } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

export type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;

export async function getSetupStatus(db: DB, ws: Workspace) {
  const [r] = rows<Record<string, string | boolean>>(
    await db.execute(sql`select
      exists(select 1 from pixel_sites where workspace_id = ${ws.id}) has_site,
      exists(select 1 from events where workspace_id = ${ws.id}) has_events,
      exists(select 1 from connections where workspace_id = ${ws.id} and provider = 'stripe' and enabled) has_stripe,
      exists(select 1 from connections where workspace_id = ${ws.id} and provider in ('meta','google_ads') and enabled) has_ads,
      exists(select 1 from api_keys where workspace_id = ${ws.id} and revoked_at is null) has_key`),
  );
  const llm = await getLlmConfig(ws, db);
  const steps = [
    { key: "pixel", done: Boolean(r.has_site && r.has_events), label: "Install the tracking pixel", desc: "One script tag on your site captures clicks, UTMs and leads.", href: "/settings?tab=tracking" },
    { key: "stripe", done: Boolean(r.has_stripe), label: "Connect Stripe", desc: "Revenue flows in via webhooks and a 90-day backfill.", href: "/settings?tab=connections" },
    { key: "ads", done: Boolean(r.has_ads), label: "Connect Meta or Google Ads", desc: "Daily spend per campaign, ad set and ad.", href: "/settings?tab=connections" },
    { key: "ai", done: Boolean(llm), label: "Choose an AI model (optional)", desc: "Ollama, OpenAI, Anthropic, Gemini… or skip it.", href: "/settings?tab=ai" },
    { key: "mcp", done: Boolean(r.has_key), label: "Ask Claude about your ads (optional)", desc: "Create an API key and add the MCP server.", href: "/settings?tab=api" },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, complete: steps.slice(0, 3).every((s) => s.done) };
}

export function Onboarding({ status }: { status: SetupStatus }) {
  return (
    <Card className="border-primary/25">
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          {status.done} of {status.steps.length} done — AdLedger gets accurate once the pixel, revenue and ad spend are all connected.
        </CardDescription>
        <Progress value={(status.done / status.steps.length) * 100} className="mt-2" />
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {status.steps.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className={cn("group rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40", s.done && "opacity-60")}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              {s.done ? <CheckCircle2Icon className="size-4 text-success" /> : <CircleIcon className="size-4 text-muted-foreground" />}
              {s.label}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
