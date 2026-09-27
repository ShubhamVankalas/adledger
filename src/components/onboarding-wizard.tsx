"use client";

import { ArrowRightIcon, CheckCircle2Icon, CheckIcon, CircleDashedIcon, ExternalLinkIcon, Loader2Icon, PartyPopperIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveOnboardingAction } from "@/app/actions/settings";
import { Snippet } from "@/components/settings/code-snippet";
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

/** Code or URL to copy. Wraps instead of scrolling sideways (unreadable on phones); the copy button sits in its own header row. */
function StepCard({ id, n, title, done, children, detail }: { id: string; n: number; title: string; done: boolean; detail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card id={id} className={cn("scroll-mt-20", done && "ring-success/30")}>
      <CardHeader className="flex flex-row items-start gap-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {done ? <CheckCircle2Icon className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {title}
            {done ? <Badge className="bg-success/15 text-success">Done</Badge> : null}
          </CardTitle>
          {detail ? <CardDescription className="mt-1">{detail}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 lg:pl-[3.75rem]">{children}</CardContent>
    </Card>
  );
}

function IntegrationChoices({ items, connected, highlight }: { items: Integration[]; connected: string[]; highlight: string[] }) {
  const sorted = [...items].sort((a, b) => Number(highlight.includes(b.provider)) - Number(highlight.includes(a.provider)));
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
      {sorted.map((i) => {
        const on = connected.includes(i.provider);
        return (
          <Link
            key={i.provider}
            href={`/settings/workspace/integrations?open=${i.provider}`}
            className={cn(
              "group flex min-h-12 min-w-0 items-center gap-2 rounded-lg border p-2 text-[13px] transition-colors hover:border-primary/40 hover:bg-accent/40 sm:gap-3 sm:p-2.5 sm:text-sm",
              highlight.includes(i.provider) && "border-primary/40 bg-primary/5",
            )}
          >
            <IntegrationLogo provider={i.provider} name={i.name} color={i.color} className="size-7 rounded-lg sm:size-8" />
            <span className="min-w-0 flex-1 leading-tight font-medium break-words">{i.name}</span>
            {on ? (
              <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-label="Connected" />
            ) : (
              <ArrowRightIcon className="hidden size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
            )}
          </Link>
        );
      })}
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
  const required = status.steps.filter((s) => !s.optional);
  const optional = status.steps.filter((s) => s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const finish = () =>
    startFinish(async () => {
      await saveOnboardingAction({ completed: true });
      router.push("/");
    });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {/* Below xl the sidebar drops under the steps, so show a compact progress + jump list first. */}
        <Card size="sm" className="xl:hidden">
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium">Essentials</div>
              <div className="tabular text-xs text-muted-foreground">
                {requiredDone} of {required.length} done
              </div>
            </div>
            <Progress value={(requiredDone / required.length) * 100} aria-label="Setup progress" />
            <ol className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
              {required.map((s, i) => (
                <li key={s.key} className="min-w-0">
                  <Link
                    href={s.href}
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary/40",
                      s.done ? "border-success/30 text-muted-foreground" : "bg-background",
                    )}
                  >
                    {s.done ? (
                      <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                    ) : (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{i + 1}</span>
                    )}
                    <span className="min-w-0 leading-tight">{s.label}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What do you use?</CardTitle>
            <CardDescription>Pick your website builder, payment tools and ad platforms. The steps below adapt to your choices.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {[
              { title: "Website", hint: "Where your site is built", items: BUILDERS.map((b) => ({ key: b.key, label: b.label })) },
              { title: "Payments & CRM", hint: "Where the money comes in", items: revenue.map((i) => ({ key: i.provider, label: i.name })) },
              { title: "Ad platforms", hint: "Where you buy ads", items: ads.map((i) => ({ key: i.provider, label: i.name })) },
            ].map((g) => (
              <div key={g.title} role="group" aria-label={g.title} className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-6">
                <div className="md:pt-2">
                  <div className="text-sm font-medium">{g.title}</div>
                  <div className="text-xs text-muted-foreground">{g.hint}</div>
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {g.items.map((it) => {
                    const on = picked.includes(it.key);
                    return (
                      <button
                        key={it.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(it.key)}
                        className={cn(
                          "inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border py-1 pr-3 pl-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9",
                          on
                            ? "border-primary/50 bg-primary/[0.07] font-medium text-foreground ring-1 ring-primary/25"
                            : "bg-background text-foreground/80 hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground dark:bg-input/30",
                        )}
                      >
                        {/* Brand marks sit on a white tile so dark logos stay visible in dark mode. */}
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-black/5">
                          <BrandGlyph id={it.key} name={it.label} onWhite className="size-3.5 text-emerald-700" />
                        </span>
                        <span className="min-w-0">{it.label}</span>
                        {on ? <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
                      </button>
                    );
                  })}
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
              <span className="inline-flex items-start gap-1.5">
                <Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin" /> Waiting for the first visit… open your website after installing and this ticks itself off.
              </span>
            )
          }
        >
          {builder ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{builder.label}</div>
              <p className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">{builder.tip}</p>
              <a href={`${DOCS}/${builder.doc}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline">
                Step-by-step guide <ExternalLinkIcon className="size-3.5" />
              </a>
            </div>
          ) : null}
          <Snippet wrap label="Paste into the <head> of every page" code={snippetFor(origin, siteKey)} />
        </StepCard>

        <StepCard id="leads" n={2} title="Capture leads" done={step("leads").done} detail="So AdLedger knows who signed up, and from which ad.">
          <div className="grid gap-4 2xl:grid-cols-2">
            <Snippet wrap label="Forms on your site: add one attribute" code={`<form data-adledger-lead="Book a demo"> … </form>`} />
            <Snippet wrap label="Typeform, Tally, Jotform, Zapier…: webhook URL" code={leadWebhookUrl} />
          </div>
        </StepCard>

        <StepCard id="revenue" n={3} title="Connect payments" done={step("revenue").done} detail="Revenue is what turns clicks into ROAS. Pick where your money comes in.">
          <IntegrationChoices items={revenue} connected={connected} highlight={picked} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Invoices, bank transfers or another checkout?{" "}
            <Link href="/settings/workspace/import" className="font-medium text-primary hover:underline">
              Import a CSV or use the Conversions API
            </Link>
            .
          </p>
        </StepCard>

        <StepCard id="ads" n={4} title="Connect ad platforms" done={step("ads").done} detail="Daily spend down to each ad. You can connect several.">
          <IntegrationChoices items={ads} connected={connected} highlight={picked} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Using Taboola, Outbrain, Quora, Amazon or affiliates?{" "}
            <Link href="/settings/workspace/import" className="font-medium text-primary hover:underline">
              Upload spend as CSV or send it through the Spend API
            </Link>
            .
          </p>
        </StepCard>
      </div>

      <div className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
        <Card className="hidden xl:flex">
          <CardHeader>
            <CardTitle>Progress</CardTitle>
            <CardDescription>
              {status.done} of {status.steps.length} done
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={(status.done / status.steps.length) * 100} aria-label="Setup progress" />
            <ul className="-mx-2 text-sm">
              {status.steps.map((s) => (
                <li key={s.key}>
                  <Link href={s.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 hover:text-primary">
                    {s.done ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />}
                    <span className={cn("min-w-0", s.done && "text-muted-foreground line-through")}>{s.label}</span>
                    {s.optional ? <span className="ml-auto text-[10px] tracking-wide text-muted-foreground uppercase">optional</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nice extras</CardTitle>
            <CardDescription className="xl:hidden">Optional, and you can do them any time from Settings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {optional.map((s) => (
              <Link key={s.key} href={s.href} className="group block rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.done ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : null}
                  <span className="min-w-0 flex-1">{s.label}</span>
                  <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Button className="h-11 w-full text-[0.95rem] sm:h-10 sm:text-sm" size="lg" disabled={finishing} onClick={finish}>
            {finishing ? <Loader2Icon className="animate-spin" /> : <PartyPopperIcon />} {status.complete ? "Finish setup" : "Continue to dashboard"}
          </Button>
          {!status.complete ? <p className="text-center text-xs text-muted-foreground">You can come back to this checklist any time from the sidebar.</p> : null}
        </div>
      </div>
    </div>
  );
}
