import { CircleAlertIcon, CircleCheckIcon, ShieldCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/lib/db";
import { dateRange, longDate } from "@/lib/format";
import { ipFromHeaders, rateLimit } from "@/lib/http";
import { lookupFingerprint, MIN_FINGERPRINT_CHARS, type VerifyResult } from "@/lib/report-kinds/verify";

// Public page: anyone holding an AdLedger PDF can check that this installation issued it.
// It confirms the report kind, workspace, period and issue date printed on the cover, and
// never shows numbers or who exported it.

export const metadata: Metadata = {
  title: "Verify a report",
  description: "Check that an AdLedger PDF report was issued by this installation.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const input = (Array.isArray(sp.fingerprint) ? sp.fingerprint[0] : sp.fingerprint)?.slice(0, 200) ?? "";
  let result: VerifyResult | { status: "limited" } = { status: "empty" };
  if (input.trim()) {
    const ip = ipFromHeaders(await headers());
    result = rateLimit(`verify:${ip}`, 20) ? await lookupFingerprint(await getDb(), input) : { status: "limited" };
  }
  const invalid = result.status === "invalid";

  return (
    <main id="main" className="relative flex min-h-svh flex-col items-center bg-background px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:justify-center sm:py-16">
      <div className="w-full max-w-lg">
        <Link href="/" className="mx-auto mb-8 flex w-fit rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Logo />
        </Link>
        <section aria-labelledby="verify-title" className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-7">
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ShieldCheckIcon className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h1 id="verify-title" className="text-lg leading-7 font-semibold tracking-tight text-balance">
                Verify a report
              </h1>
              <p className="mt-1 text-sm leading-6 text-pretty text-muted-foreground">
                Every AdLedger PDF carries a fingerprint in its footer. Paste it here to check that this installation issued the document.
              </p>
            </div>
          </div>

          <form method="get" action="/verify" className="mt-6 grid gap-2">
            <Label htmlFor="fingerprint">Fingerprint</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="fingerprint"
                name="fingerprint"
                defaultValue={input}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                inputMode="text"
                placeholder="7f3a 9c21 e04b 55d0 a1b2…"
                aria-invalid={invalid || undefined}
                aria-describedby="fingerprint-help"
                className="h-10 font-mono text-base tracking-tight sm:h-9 sm:text-[13px]"
              />
              <Button type="submit" className="h-10 px-4 sm:h-9">
                Verify
              </Button>
            </div>
            <p id="fingerprint-help" className={invalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {invalid ? `Paste at least ${MIN_FINGERPRINT_CHARS} characters of the fingerprint (0–9 and a–f).` : "Spaces don’t matter. The first 20 characters, as printed on every page, are enough."}
            </p>
          </form>

          <div aria-live="polite">
            <Result result={result} />
          </div>
        </section>
        <p className="mt-6 text-center text-xs text-balance text-muted-foreground">
          This page shows only what the report’s cover already says. It never reveals numbers or who exported it.
        </p>
      </div>
    </main>
  );
}

function Result({ result }: { result: VerifyResult | { status: "limited" } }) {
  if (result.status === "empty" || result.status === "invalid") return null;
  if (result.status === "found") {
    const r = result.report;
    return (
      <div className="mt-6 rounded-lg bg-positive-soft p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-positive">
          <CircleCheckIcon aria-hidden className="size-4" strokeWidth={2} />
          Issued by this AdLedger
        </p>
        <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Report</dt>
          <dd className="min-w-0 font-medium">{r.title}</dd>
          <dt className="text-muted-foreground">Workspace</dt>
          <dd className="min-w-0 break-words">{r.workspace}</dd>
          <dt className="text-muted-foreground">Period</dt>
          <dd className="tabular-nums">{r.start && r.end ? dateRange(r.start, r.end, { year: true }) : "—"}</dd>
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="tabular-nums">
            {longDate(r.issuedAt.slice(0, 10))}
            {r.scheduled ? <span className="text-muted-foreground"> · scheduled delivery</span> : null}
          </dd>
        </dl>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">If the figures in your copy look different from the workspace, the document was changed after it was issued.</p>
      </div>
    );
  }
  const copy = {
    not_found: { title: "No match on this installation", body: "This AdLedger didn’t issue a report with that fingerprint. The document may come from another installation, or it was altered." },
    ambiguous: { title: "More than one match", body: "Paste more of the fingerprint to pick out a single report." },
    limited: { title: "Too many checks", body: "Wait a minute and try again." },
  }[result.status];
  return (
    <div className="mt-6 rounded-lg border bg-muted/40 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleAlertIcon aria-hidden className="size-4 text-warning-foreground" strokeWidth={2} />
        {copy.title}
      </p>
      <p className="mt-1.5 text-sm leading-6 text-pretty text-muted-foreground">{copy.body}</p>
    </div>
  );
}
