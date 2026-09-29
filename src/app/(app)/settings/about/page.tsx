import { BookOpenIcon, BugIcon, ExternalLinkIcon, ScaleIcon } from "lucide-react";
import { GithubMark } from "@/components/github-mark";
import { SettingsHeader } from "@/components/settings/section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { CREATOR, REPO_URL } from "@/lib/credits";

export const metadata = { title: "About" };

const LINK =
  "group/link inline-flex min-h-10 items-center gap-2 rounded-md text-ui text-foreground underline decoration-border-strong underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <ExternalLinkIcon aria-hidden className="size-3 text-fg-faint" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export default async function AboutPage() {
  await requireUser();
  // Baked in at build time (Docker build arg); "dev" for local and source builds.
  const version = process.env.APP_VERSION ?? "0.1.0";

  return (
    <>
      <SettingsHeader title="About AdLedger" description="Free to self-host, source-available ad attribution and revenue ledger." />
      <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @4xl/settings:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>AdLedger</CardTitle>
            <CardDescription>Which ad actually made you money? Ad spend, site visits, leads and revenue in one place, on your own server.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid max-w-2xl divide-y text-ui">
              <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono text-mono text-foreground tabular-nums">{version}</dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">Source code</dt>
                <dd className="min-w-0">
                  <ExternalLink href={REPO_URL}>
                    <GithubMark />
                    <span className="truncate">ShubhamVankalas/adledger</span>
                  </ExternalLink>
                </dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">License</dt>
                <dd className="flex items-center gap-2 text-foreground">
                  <ScaleIcon aria-hidden className="size-4 text-fg-faint" strokeWidth={1.75} />
                  FSL-1.1 (converts to Apache-2.0 after two years)
                </dd>
              </div>
              <div className="grid gap-1 py-3 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-muted-foreground">Made by</dt>
                <dd className="min-w-0">
                  <ExternalLink href={CREATOR.url}>
                    <GithubMark />
                    <span className="truncate">{CREATOR.name}</span>
                  </ExternalLink>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Help and feedback</CardTitle>
            <CardDescription>Guides live in the repository. Found a bug or want a feature? Open an issue.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 md:gap-2">
              <li>
                <ExternalLink href={`${REPO_URL}/tree/main/docs`}>
                  <BookOpenIcon aria-hidden className="size-4 text-fg-faint" strokeWidth={1.75} />
                  Documentation
                </ExternalLink>
              </li>
              <li>
                <ExternalLink href={`${REPO_URL}/issues`}>
                  <BugIcon aria-hidden className="size-4 text-fg-faint" strokeWidth={1.75} />
                  Report an issue
                </ExternalLink>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
