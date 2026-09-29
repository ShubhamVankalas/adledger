import { ArrowRightIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { gatePage } from "@/components/access-denied";
import { Snippet } from "@/components/settings/code-snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { RECIPES, VERIFY_NODE } from "@/lib/webhooks/snippets";

export const metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  const canHooks = user.can("developers.access");

  return (
    <>
      <p className="max-w-3xl text-body text-pretty text-muted-foreground">
        Ready-made ways to act on your data the moment it changes. Each one starts with a webhook endpoint; the code snippets import{" "}
        <code translate="no" className="font-mono text-mono text-foreground">
          verifyAdLedger
        </code>{" "}
        from the file at the bottom of this page.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {RECIPES.map((r) => (
          <Card key={r.id} id={r.id} className="min-w-0 scroll-mt-24">
            <CardHeader>
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{r.tool}</Badge>
                {r.events.map((e) => (
                  <Badge key={e} variant="outline">
                    <span translate="no" className="font-mono">
                      {e}
                    </span>
                  </Badge>
                ))}
                {r.pii ? (
                  <Badge variant="warning">
                    <ShieldAlertIcon aria-hidden /> Needs personal data
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-balance">{r.title}</CardTitle>
              <CardDescription className="text-pretty">{r.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <ol className="grid gap-2">
                {r.steps.map((s, i) => (
                  <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-ui text-pretty">
                    <span aria-hidden className="flex size-5 items-center justify-center rounded-sm bg-fill text-micro text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ol>
              {r.code ? <Snippet label={r.code.label} code={r.code.code} className="mt-auto" /> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>verify-adledger.js</CardTitle>
            <CardDescription>Shared by the recipes: rejects requests that weren&rsquo;t signed by this AdLedger install, or are older than five minutes.</CardDescription>
          </div>
          {canHooks ? (
            <Button className="h-10 max-sm:w-full sm:h-8" render={<Link href="/developers/webhooks" />}>
              Add an endpoint <ArrowRightIcon aria-hidden />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <Snippet label="verify-adledger.js" code={VERIFY_NODE} />
        </CardContent>
      </Card>
    </>
  );
}
