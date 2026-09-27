"use client";

import { GlobeIcon, Loader2Icon, PlusIcon, ShieldCheckIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createLeadWebhookAction,
  createPixelSiteAction,
  deleteLeadWebhookAction,
  deletePixelSiteAction,
  updatePixelSiteAction,
} from "@/app/actions/settings";
import { setPixelConsentModeAction } from "@/app/actions/tracking";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BANNER_SNIPPETS, CONSENT_MODE_ORDER, CONSENT_MODES, type PixelConsentMode } from "@/lib/tracking/consent-modes";
import { cn } from "@/lib/utils";
import { Snippet } from "./code-snippet";

type Site = { id: string; name: string; domains: string; publicKey: string; consentMode: PixelConsentMode };
type Hook = { id: string; name: string; token: string };

export function snippetFor(origin: string, key: string, mode: PixelConsentMode = "optout") {
  const consent = mode === "optout" ? "" : ` data-consent="${mode}"`;
  return `<!-- AdLedger -->
<script>window.adledger=window.adledger||{q:[]};["identify","lead","track","consent"].forEach(function(m){adledger[m]=adledger[m]||function(){adledger.q.push([m].concat([].slice.call(arguments)))}});</script>
<script async src="${origin}/p/al.js" data-site="${key}"${consent}></script>`;
}

/** Three plain-language choices, saved as soon as one is picked. */
function ConsentModePicker({ site, mode, onChange }: { site: Site; mode: PixelConsentMode; onChange: (m: PixelConsentMode) => void }) {
  const name = useId();
  const [pending, start] = useTransition();
  const router = useRouter();
  const choose = (next: PixelConsentMode) => {
    if (next === mode) return;
    const prev = mode;
    onChange(next);
    start(async () => {
      const r = await setPixelConsentModeAction(site.id, next);
      if (r.ok) toast.success(r.message ?? "Saved");
      else {
        onChange(prev);
        toast.error(r.message ?? "Couldn't save the consent mode. Try again.");
      }
      router.refresh();
    });
  };
  return (
    <fieldset disabled={pending} className="min-w-0">
      <legend className="sr-only">Consent mode for {site.name}</legend>
      <div className="divide-y overflow-hidden rounded-lg border">
        {CONSENT_MODE_ORDER.map((m) => {
          const info = CONSENT_MODES[m];
          const checked = m === mode;
          return (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer gap-3 px-3.5 py-3 transition-colors has-[:focus-visible]:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-inset",
                checked ? "bg-muted/50" : "hover:bg-muted/30",
              )}
            >
              <input type="radio" name={name} value={m} checked={checked} onChange={() => choose(m)} className="peer sr-only" />
              <span
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 rounded-full border border-input bg-background transition-[border-color,box-shadow] peer-checked:border-foreground peer-checked:shadow-[inset_0_0_0_4px_var(--background),inset_0_0_0_8px_var(--foreground)]"
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{info.label}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 font-medium text-muted-foreground">{info.tag}</span>
                  {checked && pending ? <Loader2Icon className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
                </span>
                <span className="block text-xs text-pretty text-muted-foreground">
                  {info.summary}
                  {checked ? <> {info.detail}</> : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 flex gap-1.5 text-xs text-pretty text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>Global Privacy Control is always honoured: those visitors&rsquo; conversions reach Meta and Google with limited data.</span>
      </p>
    </fieldset>
  );
}

const BANNER_INTRO: Record<PixelConsentMode, string> = {
  optout: "Optional. When a visitor rejects marketing cookies, AdLedger forgets them and stops tracking.",
  required: "Needed in this mode: AdLedger stays silent until your banner reports a yes.",
  cookieless: "Optional. A yes upgrades the visitor to a cookie, so their visits join into one journey.",
};

function BannerSnippets({ mode }: { mode: PixelConsentMode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-pretty text-muted-foreground">{BANNER_INTRO[mode]}</p>
      <Tabs defaultValue={BANNER_SNIPPETS[0].id} className="gap-2">
        <TabsList aria-label="Cookie banner" className="w-full flex-wrap justify-start gap-0.5 group-data-horizontal/tabs:h-auto">
          {BANNER_SNIPPETS.map((b) => (
            <TabsTrigger key={b.id} value={b.id} className="h-7 flex-none px-2.5 text-xs">
              {b.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {BANNER_SNIPPETS.map((b) => (
          <TabsContent key={b.id} value={b.id} className="space-y-1.5">
            <Snippet label={b.language} code={b.code} />
            <p className="text-xs text-pretty text-muted-foreground">{b.note}</p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 @lg/settings:grid-cols-[2rem_minmax(0,1fr)]">
      <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary tabular-nums">{n}</span>
      <div className="min-w-0 space-y-2">
        <div className="pt-1 text-sm font-medium text-pretty">{title}</div>
        {children}
      </div>
    </div>
  );
}

function SiteCard({ site, origin }: { site: Site; origin: string }) {
  const [domains, setDomains] = useState(site.domains);
  const [mode, setMode] = useState<PixelConsentMode>(site.consentMode);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <GlobeIcon className="size-4 shrink-0 text-muted-foreground" /> <span className="truncate">{site.name}</span>
        </CardTitle>
        <CardDescription>
          Site key <code translate="no" className="text-xs break-all">{site.publicKey}</code> <span className="whitespace-nowrap">(public — it can only send events)</span>
        </CardDescription>
        <CardAction>
          <ActionButton action={() => deletePixelSiteAction(site.id)} variant="ghost" size="icon-sm" confirm="Remove this website? Its snippet will stop working." aria-label={`Remove ${site.name}`}>
            <Trash2Icon />
          </ActionButton>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        <Step n={1} title="Choose how the pixel handles consent">
          <ConsentModePicker site={site} mode={mode} onChange={setMode} />
        </Step>
        <Step n={2} title="Paste this into the <head> of every page">
          <Snippet label="HTML" code={snippetFor(origin, site.publicKey, mode)} />
          <p className="text-xs text-muted-foreground">
            Captures page views, UTMs, click IDs (gclid, fbclid…) and a first-party visitor ID. Works with SPAs. Tip: serve AdLedger from a subdomain of your site (e.g.{" "}
            <code translate="no">t.yoursite.com</code>) so cookies stay first-party.
          </p>
        </Step>
        <Step n={3} title="Connect your cookie banner">
          <BannerSnippets mode={mode} />
        </Step>
        <Step n={4} title="Capture leads">
          <p className="text-xs text-muted-foreground">Either add an attribute to any form — AdLedger picks up the email/phone/name fields on submit:</p>
          <Snippet label="HTML" code={`<form data-adledger-lead="Book a demo">
  <!-- your email, phone and name fields -->
</form>`} />
          <p className="text-xs text-muted-foreground">…or call it yourself after a signup:</p>
          <Snippet label="JavaScript" code={`adledger.lead({ email: "jane@acme.com", name: "Jane" }, "Signup");`} />
        </Step>
        <Step n={5} title="Pass the visitor ID to Stripe Checkout (recommended)">
          <Snippet
            label="Stripe"
            code={`// when creating the Checkout Session
client_reference_id: adledger.getVisitorId(),
// or for Payment Links / Payment Intents
metadata: { adledger_vid: adledger.getVisitorId() }`}
          />
          <p className="text-xs text-muted-foreground">Without it AdLedger still matches payments to leads by email.</p>
        </Step>
        <Step n={6} title="Allowed domains (optional)">
          <div className="flex gap-2">
            <Input
              name="domains"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="yoursite.com, shop.yoursite.com…"
              aria-label="Allowed domains"
              className="max-w-md"
            />
            <ActionButton action={() => updatePixelSiteAction(site.id, domains)} variant="outline" className="md:h-9">
              Save
            </ActionButton>
          </div>
          <p className="text-xs text-muted-foreground">Only accept events from these domains (subdomains included). Leave empty to accept any.</p>
        </Step>
      </CardContent>
    </Card>
  );
}

export function TrackingSection({ origin, sites, hooks }: { origin: string; sites: Site[]; hooks: Hook[] }) {
  const addSite = useFormAction(createPixelSiteAction);
  const addHook = useFormAction(createLeadWebhookAction);
  return (
    <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @5xl/settings:grid-cols-5">
      <div className="min-w-0 space-y-5 md:space-y-6 @5xl/settings:col-span-3">
        {sites.map((s) => (
          <SiteCard key={s.id} site={s} origin={origin} />
        ))}
        <Card>
          <CardHeader>
            <CardTitle>{sites.length ? "Add another website" : "Add your website"}</CardTitle>
            <CardDescription>Each website gets its own pixel snippet.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={addSite.submit} className="grid gap-3 @xl/settings:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @xl/settings:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="site-name">Name</Label>
                <Input id="site-name" name="name" autoComplete="off" placeholder="Marketing site…" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="site-domains">Domain (optional)</Label>
                <Input id="site-domains" name="domains" autoComplete="off" spellCheck={false} inputMode="url" placeholder="yoursite.com…" />
              </div>
              <Button type="submit" disabled={addSite.pending} className="md:h-9">
                {addSite.pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                {addSite.pending ? "Adding…" : "Add website"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-5 md:space-y-6 @5xl/settings:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WebhookIcon className="size-4 text-muted-foreground" /> Lead webhooks
            </CardTitle>
            <CardDescription>For Typeform, Tally, Webflow, Zapier, Make or any form that can POST. Email, phone and name are detected automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {hooks.map((h) => {
              const url = `${origin}/api/v1/webhooks/leads/${h.token}`;
              return (
                <div key={h.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{h.name}</span>
                    <ActionButton action={() => deleteLeadWebhookAction(h.id)} variant="ghost" size="icon-sm" confirm="Delete this webhook? Forms posting to its URL will stop sending leads." aria-label={`Delete ${h.name}`}>
                      <Trash2Icon />
                    </ActionButton>
                  </div>
                  <CopyField value={url} />
                </div>
              );
            })}
            {hooks.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No lead webhooks yet. Name one below to get its URL.</p>
            ) : null}
            <form action={addHook.submit} className="flex gap-2">
              <Input name="name" autoComplete="off" placeholder="e.g. Typeform – Demo requests…" aria-label="Webhook name" />
              <Button type="submit" variant="outline" disabled={addHook.pending} className="md:h-9">
                {addHook.pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                {addHook.pending ? "Creating…" : "Create"}
              </Button>
            </form>
            {hooks[0] ? (
              <div className="space-y-2">
                <Snippet
                  label="Test it"
                  code={`curl -X POST ${origin}/api/v1/webhooks/leads/${hooks[0].token} \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test@example.com","name":"Test Lead"}'`}
                />
                <p className="text-xs text-muted-foreground">
                  Include a hidden field{" "}
                  <Badge variant="outline" translate="no">
                    al_vid
                  </Badge> set to <code translate="no">adledger.getVisitorId()</code> to connect the lead to its ad clicks.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recommended UTM templates</CardTitle>
            <CardDescription>IDs in UTMs let AdLedger match visits to exact ads, even after you rename them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Snippet
              wrap
              label="Meta Ads → Ad → URL parameters"
              code="utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}"
            />
            <div className="space-y-1.5">
              <Snippet
                wrap
                label="Google Ads → Account settings → Final URL suffix"
                code="utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={adgroupid}&utm_content={creative}"
              />
              <p className="text-xs text-muted-foreground">Keep auto-tagging (gclid) on as well.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
