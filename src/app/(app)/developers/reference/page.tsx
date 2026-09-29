import { gatePage } from "@/components/access-denied";
import { ApiOperation } from "@/components/developers/api-operation";
import { CopyField } from "@/components/copy-field";
import { Snippet } from "@/components/settings/code-snippet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiReference } from "@/lib/api-reference";
import { publicUrl } from "@/lib/url";
import { MAX_ATTEMPTS, sampleEvent, SIGNATURE_HEADER, WEBHOOK_EVENTS } from "@/lib/webhooks/catalog";
import { VERIFY_EXPRESS, VERIFY_NODE, VERIFY_PYTHON } from "@/lib/webhooks/snippets";

export const metadata = { title: "API reference" };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default async function ApiReferencePage() {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const origin = await publicUrl();
  const groups = apiReference(origin);
  const count = groups.reduce((n, g) => n + g.ops.length, 0);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Reference sections" className="lg:sticky lg:top-24">
        <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible">
          {[...groups.map((g) => g.tag), "Webhook events"].map((t) => (
            <li key={t} className="shrink-0">
              <a href={`#${slug(t)}`} className="block rounded-md px-2.5 py-1.5 text-ui whitespace-nowrap text-muted-foreground outline-none hover:bg-fill-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                {t}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>REST API</CardTitle>
            <CardDescription className="text-pretty">
              {count} endpoints for API keys, generated from the OpenAPI spec this server ships. Keys only reach their own workspace and only what their scopes allow;
              contact emails stay masked without the <code translate="no">contacts:pii</code> scope. Examples read the key from <code translate="no">ADLEDGER_API_KEY</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-caption font-medium text-muted-foreground">Base URL</div>
              <CopyField value={`${origin}/api/v1`} />
            </div>
            <div className="space-y-1.5">
              <div className="text-caption font-medium text-muted-foreground">OpenAPI spec</div>
              <CopyField value={`${origin}/api/v1/openapi.json`} />
            </div>
          </CardContent>
        </Card>

        {groups.map((g) => (
          <section key={g.tag} id={slug(g.tag)} aria-labelledby={`${slug(g.tag)}-title`} className="scroll-mt-24">
            <Card className="gap-0 pb-0">
              <CardHeader className="border-b">
                <CardTitle id={`${slug(g.tag)}-title`}>{g.tag}</CardTitle>
                <CardDescription className="text-pretty">{g.description.replace(/`/g, "")}</CardDescription>
              </CardHeader>
              <div className="divide-y">
                {g.ops.map((op) => (
                  <ApiOperation key={op.id} op={op} />
                ))}
              </div>
            </Card>
          </section>
        ))}

        <section id="webhook-events" aria-labelledby="webhook-events-title" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle id="webhook-events-title">Webhook events</CardTitle>
              <CardDescription className="text-pretty">
                AdLedger POSTs JSON to your endpoint with <code translate="no">{SIGNATURE_HEADER}: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where v1 is the HMAC-SHA256
                of <code translate="no">&lt;t&gt;.&lt;raw body&gt;</code> with your signing secret. Answer 2xx within 10 seconds; anything else is retried up to {MAX_ATTEMPTS} times
                (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h). Dedupe on <code translate="no">id</code>: a retried or resent event keeps it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 xl:grid-cols-2">
                <Snippet label="Verify: Node.js" code={VERIFY_NODE} />
                <Snippet label="Verify: Python" code={VERIFY_PYTHON} />
              </div>
              <Snippet label="Receive with Express" code={VERIFY_EXPRESS} />
              <div className="divide-y rounded-lg border">
                {WEBHOOK_EVENTS.map((e) => (
                  <details key={e.type} className="group/ev">
                    <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2.5 outline-none hover:bg-fill/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                      <code translate="no" className="font-mono text-mono font-medium text-foreground">
                        {e.type}
                      </code>
                      <span className="text-ui text-pretty text-muted-foreground">{e.description}</span>
                    </summary>
                    <div className="border-t bg-bg-subtle/60 p-3">
                      <Snippet label="Example payload (personal data off)" code={JSON.stringify(sampleEvent(e.type), null, 2)} />
                    </div>
                  </details>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
