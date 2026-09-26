"use client";

import { ArrowRightIcon, CheckCircle2Icon, CircleDashedIcon, ExternalLinkIcon, Loader2Icon, PartyPopperIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveOnboardingAction } from "@/app/actions/settings";
import { CodeBlock, CopyField } from "@/components/copy-field";
import { BrandGlyph } from "@/components/brand-icon";
import { IntegrationLogo } from "@/components/settings/integration-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SetupStatus } from "./onboarding";
import { snippetFor } from "./settings/tracking-section";

type Integration = { provider: string; name: string; category: string; color: string; status: string };

const DOCS = "https://github.com/ShubhamVankalas/adledger/blob/main/docs/integrations";
const BUILDERS = [
  { key: "site:wordpress", label: "WordPress / WooCommerce", doc: "wordpress.md", tip: "Install the AdLedger plugin (integrations/wordpress/adledger.zip), paste your site key in Settings → AdLedger. Forms and WooCommerce orders are tracked automatically." },
  { key: "site:shopify", label: "Shopify", doc: "shopify.md", tip: "Add the AdLedger custom pixel under Settings → Customer events, then connect the Shopify integration for orders." },
  { key: "site:webflow", label: "Webflow", doc: "webflow.md", tip: "Paste the snippet in Site settings → Custom code → Head code, then publish." },
  { key: "site:wix", label: "Wix", doc: "wix.md", tip: "Settings → Custom code → Add code to the head of all pages." },
  { key: "site:squarespace", label: "Squarespace", doc: "squarespace.md", tip: "Settings → Advanced → Code injection → Header." },
  { key: "site:framer", label: "Framer", doc: "framer.md", tip: "Site settings → General → Custom code → Start of <head> tag." },
  { key: "site:gtm", label: "Google Tag Manager", doc: "gtm.md", tip: "Create a Custom HTML tag with the snippet and fire it on All Pages." },
  { key: "site:code", label: "Custom code / React / Next.js", doc: "nextjs-react.md", tip: "Paste the snippet in your root layout's <head>. It follows client-side navigation automatically." },
];

function StepCard({ id, n, title, done, children, detail }: { id: string; n: number; title: string; done: boolean; detail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card id={id} className={cn("scroll-mt-24", done && "border-success/30")}>
      <CardHeader className="flex flex-row items-start gap-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {done ? <CheckCircle2Icon className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {title}
            {done ? <Badge className="bg-success/15 text-success">Done</Badge> : null}
          </CardTitle>
          {detail ? <CardDescription className="mt-1">{detail}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pl-4 sm:pl-[3.75rem]">{children}</CardContent>
    </Card>
  );
}

function IntegrationChoices({ items, connected, highlight }: { items: Integration[]; connected: string[]; highlight: string[] }) {
  const sorted = [...items].sort((a, b) => Number(highlight.includes(b.provider)) - Number(highlight.includes(a.provider)));
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {sorted.map((i) => (
        <Link
          key={i.provider}
          href={`/settings/workspace/integrations?open=${i.provider}`}
          className={cn(
            "flex items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40",
            highlight.includes(i.provider) && "border-primary/40 bg-primary/5",
          )}
        >
          <IntegrationLogo provider={i.provider} name={i.name} color={i.color} className="size-8 text-[11px]" />
          <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
          {connected.includes(i.provider) ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        </Link>
      ))}
    </div>
  );
}

export function OnboardingWizard({
  origin,
  siteKey,
  leadWebhookUrl,
  status,
  picked: initialPicked,
  integrations,
  connected,
}: {
  origin: string;
  siteKey: string;
  leadWebhookUrl: string;
  status: SetupStatus;
  picked: string[];
  integrations: Integration[];
  connected: string[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(initialPicked);
  const [finishing, startFinish] = useTransition();
  const step = (key: string) => status.steps.find((s) => s.key === key)!;
  const pixelDone = step("pixel").done;

  // While waiting for the first pixel event, re-check every 5 seconds.
  useEffect(() => {
    if (pixelDone) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [pixelDone, router]);

  const toggle = (key: string) => {
    const next = picked.includes(key) ? picked.filter((p) => p !== key) : [...picked, key];
    setPicked(next);
    void saveOnboardingAction({ platforms: next });
  };

  const builder = BUILDERS.find((b) => picked.includes(b.key));
  const ads = integrations.filter((i) => i.category === "ads");
  const revenue = integrations.filter((i) => i.category === "revenue");
  const optional = status.steps.filter((s) => s.optional);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>What do you use?</CardTitle>
            <CardDescription>Pick your website builder, payment tools and ad platforms. The steps below adapt to your choices.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { title: "Website", items: BUILDERS.map((b) => ({ key: b.key, label: b.label })) },
              { title: "Payments & stores", items: revenue.map((i) => ({ key: i.provider, label: i.name })) },
              { title: "Ad platforms", items: ads.map((i) => ({ key: i.provider, label: i.name })) },
            ].map((g) => (
              <div key={g.title}>
                <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.title}</div>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      aria-pressed={picked.includes(it.key)}
                      onClick={() => toggle(it.key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:border-primary/40",
                        picked.includes(it.key) ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
                      )}
                    >
                      <span className={cn("flex size-4 items-center justify-center rounded-full", picked.includes(it.key) && "bg-white")}>
                        <BrandGlyph id={it.key} onWhite={picked.includes(it.key)} className="size-3" />
                      </span>
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <StepCard
          id="pixel"
          n={1}
          title="Install the tracking pixel"
          done={pixelDone}
          detail={
            pixelDone ? (
              <>Receiving data — last event {timeAgo(status.lastEventAt)}.</>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Loader2Icon className="size-3.5 animate-spin" /> Waiting for the first visit… open your website after installing and this ticks itself off.
              </span>
            )
          }
        >
          {builder ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{builder.label}</div>
              <p className="mt-1 text-muted-foreground">{builder.tip}</p>
              <a href={`${DOCS}/${builder.doc}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Step-by-step guide <ExternalLinkIcon className="size-3.5" />
              </a>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Paste into the &lt;head&gt; of every page</div>
            <CodeBlock code={snippetFor(origin, siteKey)} />
          </div>
        </StepCard>

        <StepCard id="leads" n={2} title="Capture leads" done={step("leads").done} detail="So AdLedger knows who signed up, and from which ad.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Forms on your site: add one attribute</div>
              <CodeBlock code={`<form data-adledger-lead="Book a demo"> … </form>`} />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Typeform, Tally, Jotform, Zapier…: paste this webhook URL</div>
              <CopyField value={leadWebhookUrl} />
            </div>
          </div>
        </StepCard>

        <StepCard id="revenue" n={3} title="Connect payments" done={step("revenue").done} detail="Revenue is what turns clicks into ROAS. Pick where your money comes in.">
          <IntegrationChoices items={revenue} connected={connected} highlight={picked} />
          <p className="text-xs text-muted-foreground">
            Invoices, bank transfers or another checkout?{" "}
            <Link href="/settings/workspace/import" className="font-medium text-primary hover:underline">
              Import a CSV or use the Conversions API
            </Link>
            .
          </p>
        </StepCard>

        <StepCard id="ads" n={4} title="Connect ad platforms" done={step("ads").done} detail="Daily spend down to each ad. You can connect several.">
          <IntegrationChoices items={ads} connected={connected} highlight={picked} />
          <p className="text-xs text-muted-foreground">
            Using Taboola, Outbrain, Quora, Amazon or affiliates?{" "}
            <Link href="/settings/workspace/import" className="font-medium text-primary hover:underline">
              Upload spend as CSV or send it through the Spend API
            </Link>
            .
          </p>
        </StepCard>
      </div>

      <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
            <CardDescription>
              {status.done} of {status.steps.length} done
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={(status.done / status.steps.length) * 100} />
            <ul className="space-y-2 text-sm">
              {status.steps.map((s) => (
                <li key={s.key}>
                  <Link href={s.href} className="flex items-center gap-2 hover:text-primary">
                    {s.done ? <CheckCircle2Icon className="size-4 text-success" /> : <CircleDashedIcon className="size-4 text-muted-foreground" />}
                    <span className={cn(s.done && "text-muted-foreground line-through")}>{s.label}</span>
                    {s.optional ? <span className="ml-auto text-[10px] text-muted-foreground uppercase">optional</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nice extras</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {optional.map((s) => (
              <Link key={s.key} href={s.href} className="block rounded-lg border p-3 transition-colors hover:border-primary/40">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.done ? <CheckCircle2Icon className="size-4 text-success" /> : null}
                  {s.label}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          disabled={finishing}
          onClick={() =>
            startFinish(async () => {
              await saveOnboardingAction({ completed: true });
              router.push("/");
            })
          }
        >
          <PartyPopperIcon /> {status.complete ? "Finish setup" : "Continue to dashboard"}
        </Button>
      </div>
    </div>
  );
}
