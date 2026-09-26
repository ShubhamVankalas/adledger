"use client";

import { CheckCircle2Icon, CircleAlertIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { disconnectAction, saveConnectionAction, syncNowAction } from "@/app/actions/settings";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CodeBlock, CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeAgo } from "@/lib/format";

type Conn = {
  provider: "meta" | "google_ads" | "stripe";
  connected: boolean;
  mode: "mock" | "live" | null;
  config: Record<string, string>;
  secretKeys: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  runs: { status: string; startedAt: string; rows: number; error: string | null }[];
};

type FieldDef = { name: string; label: string; secret?: boolean; placeholder?: string; hint?: string };

const META: Record<Conn["provider"], { title: string; blurb: string; docs: string; fields: FieldDef[]; steps: React.ReactNode[] }> = {
  meta: {
    title: "Meta Ads",
    blurb: "Daily spend, impressions and clicks per campaign, ad set and ad (Facebook + Instagram).",
    docs: "https://developers.facebook.com/docs/marketing-api/get-started",
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "act_1234567890, act_987…", hint: "Comma-separated. Find them in Ads Manager → account dropdown." },
      { name: "accessToken", label: "Access token", secret: true, placeholder: "EAAB…", hint: "A System User token with ads_read permission (never expires)." },
      { name: "apiVersion", label: "API version (optional)", placeholder: "v26.0" },
    ],
    steps: [
      <>Open <strong>Business Settings → Users → System users</strong> and add a system user (Admin).</>,
      <>Click <strong>Add assets</strong> → Ad accounts → give it <em>View performance</em> access.</>,
      <>Click <strong>Generate new token</strong>, pick any app (create one at developers.facebook.com if needed), tick <code>ads_read</code>, and paste the token here.</>,
    ],
  },
  google_ads: {
    title: "Google Ads",
    blurb: "Daily cost, impressions and clicks per campaign, ad group and ad via the Google Ads API.",
    docs: "https://developers.google.com/google-ads/api/docs/first-call/overview",
    fields: [
      { name: "customerIds", label: "Customer IDs", placeholder: "123-456-7890", hint: "Comma-separated account IDs to import." },
      { name: "loginCustomerId", label: "Manager (MCC) ID (optional)", placeholder: "111-222-3333", hint: "Only if you access the accounts through a manager account." },
      { name: "developerToken", label: "Developer token", secret: true, hint: "Google Ads → Tools → API Center. Basic access is enough." },
      { name: "clientId", label: "OAuth client ID", placeholder: "…apps.googleusercontent.com" },
      { name: "clientSecret", label: "OAuth client secret", secret: true },
      { name: "refreshToken", label: "OAuth refresh token", secret: true, hint: "Generate once with the OAuth Playground using scope https://www.googleapis.com/auth/adwords." },
      { name: "apiVersion", label: "API version (optional)", placeholder: "v25" },
    ],
    steps: [
      <>Apply for a <strong>developer token</strong> in Google Ads → Tools → API Center (approval can take a few days — do this first).</>,
      <>In Google Cloud Console, enable the <strong>Google Ads API</strong> and create an OAuth client (type: Web, redirect <code>https://developers.google.com/oauthplayground</code>).</>,
      <>In the <strong>OAuth Playground</strong> (gear icon → use your own credentials) authorize the <code>adwords</code> scope and exchange for a refresh token.</>,
    ],
  },
  stripe: {
    title: "Stripe",
    blurb: "Payments and refunds via webhooks, plus a 90-day backfill. Matched to people by visitor ID or email.",
    docs: "https://dashboard.stripe.com/apikeys",
    fields: [
      { name: "apiKey", label: "Secret or restricted key", secret: true, placeholder: "rk_live_… or sk_live_…", hint: "A restricted key with read access to Charges, Customers and Checkout Sessions is enough." },
      { name: "webhookSecret", label: "Webhook signing secret", secret: true, placeholder: "whsec_…" },
    ],
    steps: [
      <>Create a <strong>restricted key</strong> (Developers → API keys) with <em>Read</em> on Charges, Customers, Checkout Sessions.</>,
      <>Add a webhook endpoint (Developers → Webhooks) with the URL below and events <code>charge.succeeded</code>, <code>charge.refunded</code>, <code>checkout.session.completed</code>.</>,
      <>Copy the endpoint&apos;s <strong>signing secret</strong> here, save, then click <strong>Sync now</strong> to import history.</>,
    ],
  },
};

function Status({ c, forcedMock }: { c: Conn; forcedMock: boolean }) {
  if (!c.connected) return <Badge variant="outline">Not connected</Badge>;
  if (c.lastError) return <Badge variant="destructive">Error</Badge>;
  if (c.mode === "mock" || forcedMock) return <Badge variant="secondary">Demo data</Badge>;
  return (
    <Badge className="bg-success/15 text-success">
      <CheckCircle2Icon /> Connected
    </Badge>
  );
}

function ConnectionCard({ c, origin, workspaceId, forcedMock }: { c: Conn; origin: string; workspaceId: string; forcedMock: boolean }) {
  const m = META[c.provider];
  const save = useFormAction((f) => saveConnectionAction(c.provider, f));
  const webhookUrl = `${origin}/api/v1/webhooks/stripe/${workspaceId}`;
  const isDemo = c.mode === "mock";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.title}</CardTitle>
        <CardDescription>{m.blurb}</CardDescription>
        <CardAction>
          <Status c={c} forcedMock={forcedMock} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {c.lastError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {c.lastError}
          </div>
        ) : null}
        {isDemo ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Using built-in demo data. Enter your real credentials below and save to switch this connection to live data.
          </p>
        ) : null}

        <ol className="space-y-1.5 text-xs text-muted-foreground">
          {m.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold text-foreground">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        {c.provider === "stripe" ? (
          <div className="space-y-1.5">
            <Label>Webhook endpoint URL</Label>
            <CopyField value={webhookUrl} />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Testing locally with the Stripe CLI</summary>
              <CodeBlock className="mt-2" code={`stripe listen --forward-to ${webhookUrl}`} />
              <p className="mt-1">Paste the <code>whsec_…</code> secret it prints into the signing secret field.</p>
            </details>
          </div>
        ) : null}

        <form action={save.submit} className="grid gap-3 sm:grid-cols-2">
          {m.fields.map((f) => {
            const saved = f.secret && c.secretKeys.includes(f.name);
            return (
              <div key={f.name} className="grid gap-1.5">
                <Label htmlFor={`${c.provider}-${f.name}`}>{f.label}</Label>
                <Input
                  id={`${c.provider}-${f.name}`}
                  name={f.name}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  defaultValue={f.secret || isDemo ? "" : (c.config[f.name] ?? "")}
                  placeholder={saved ? "•••••••• saved — leave blank to keep" : f.placeholder}
                />
                {f.hint ? <p className="text-[11px] text-muted-foreground">{f.hint}</p> : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.pending}>
              Save credentials
            </Button>
            <Button variant="ghost" size="sm" render={<a href={m.docs} target="_blank" rel="noreferrer" />}>
              Docs <ExternalLinkIcon />
            </Button>
          </div>
        </form>
      </CardContent>
      {c.connected ? (
        <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t text-xs text-muted-foreground">
          <span>
            Last sync {timeAgo(c.lastSyncedAt)}
            {c.runs[0] ? ` · ${c.runs[0].status}${c.runs[0].rows ? ` · ${c.runs[0].rows.toLocaleString()} rows` : ""}` : ""}
          </span>
          <div className="flex gap-2">
            <ActionButton action={() => syncNowAction(c.provider)} variant="outline" size="sm">
              <RefreshCwIcon /> Sync now
            </ActionButton>
            <ActionButton action={() => disconnectAction(c.provider)} variant="ghost" size="sm" confirm={`Disconnect ${m.title}? Imported data is kept.`}>
              Disconnect
            </ActionButton>
          </div>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function ConnectionsSection({ origin, workspaceId, connections, forcedMock }: { origin: string; workspaceId: string; connections: Conn[]; forcedMock: boolean }) {
  return (
    <div className="space-y-6">
      {forcedMock ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <code>CONNECTOR_MODE=mock</code> is set on the server, so every connector returns demo data. Remove it to use live APIs.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {connections.map((c) => (
          <ConnectionCard key={c.provider} c={c} origin={origin} workspaceId={workspaceId} forcedMock={forcedMock} />
        ))}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>How syncing works</CardTitle>
            <CardDescription>AdLedger runs everything inside one app — no extra workers to manage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Ad spend syncs every 6 hours (yesterday + trailing 7 days, because platforms restate recent data). Re-syncing never duplicates rows.</p>
            <p>• Stripe payments arrive instantly via webhooks; “Sync now” backfills the last 90 days.</p>
            <p>• Attribution is recomputed automatically after every sync, lead and payment.</p>
            <p>• Credentials are encrypted at rest (AES-256-GCM) and never shown again after saving.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
