import { ArrowLeftIcon, CircleAlertIcon } from "lucide-react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { OAuthAccountPicker } from "@/components/settings/oauth-account-picker";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getAdsConnector } from "@/lib/connectors/registry";
import { oauthCredentials } from "@/lib/oauth/flow";
import { cleanMessage, getOAuthProvider, OAuthError, type AdAccountOption } from "@/lib/oauth/providers";
import { openPending, PENDING_COOKIE } from "@/lib/oauth/state";
import { getAppSecret, getConnection } from "@/lib/settings";

export const metadata = { title: "Connect ad accounts" };

const INTEGRATIONS = "/settings/workspace/integrations";

export default async function OAuthConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("workspace.settings");
  const { provider } = await params;
  const { error } = await searchParams;
  const connector = getAdsConnector(provider);
  const p = getOAuthProvider(provider);
  if (!connector?.meta.oauth || !p) notFound();
  const { meta } = connector;
  const label = meta.oauth!.label;
  const startHref = `/api/v1/oauth/${provider}/start`;

  let problem = error ? cleanMessage(error, 240) : null;
  let accounts: AdAccountOption[] = [];
  let preselected: string[] = [];
  if (!problem) {
    const pending = openPending((await cookies()).get(PENDING_COOKIE)?.value, await getAppSecret(), {
      provider,
      userId: user.id,
      workspaceId: user.workspace.id,
    });
    const creds = oauthCredentials(provider);
    if (!pending) problem = `No ${label} sign-in in progress (it expires after 15 minutes). Click “Connect with ${label}” to start.`;
    else if (!creds) problem = `One-click connect isn’t set up on this server. An admin needs to set ${meta.oauth!.env.join(", ")}.`;
    else {
      try {
        accounts = await p.listAccounts(pending.tokens, creds, fetch);
      } catch (err) {
        problem = err instanceof OAuthError ? err.message : `Couldn’t reach ${label} to list your ad accounts. Try again.`;
      }
      // Reconnecting: keep the accounts already imported ticked. First time: every active account.
      const existing = await getConnection(user.workspace.id, provider);
      const norm = (s: string) => s.replace(/^act_/, "").replace(/[^A-Za-z0-9]/g, "");
      const savedIds = new Set(
        existing?.mode === "live" ? String(existing.config[p.accountsKey] ?? "").split(/[\s,]+/).map(norm).filter(Boolean) : [],
      );
      const current = accounts.filter((a) => savedIds.has(norm(a.id)));
      preselected = (current.length ? current : accounts.filter((a) => !a.note)).map((a) => a.id);
    }
  }

  return (
    <>
      <SettingsHeader
        title={`Connect ${meta.name}`}
        description={`Choose which ${label} ad accounts to import into ${user.workspace.name}. You can change this later by connecting again.`}
      >
        <Button variant="ghost" size="sm" render={<a href={INTEGRATIONS} />}>
          <ArrowLeftIcon aria-hidden /> Integrations
        </Button>
      </SettingsHeader>
      {problem ? (
        <div className="max-w-2xl space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{problem}</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button render={<a href={startHref} />}>Connect with {label}</Button>
            <Button variant="outline" render={<a href={INTEGRATIONS} />}>
              Back to integrations
            </Button>
          </div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="max-w-2xl space-y-3 text-sm text-muted-foreground">
          <p>
            Signed in, but this {label} login can’t see any ad accounts. Ask the account owner to give your user access, or sign in with a
            different {label} user.
          </p>
          <Button variant="outline" render={<a href={startHref} />}>
            Sign in again
          </Button>
        </div>
      ) : (
        <OAuthAccountPicker provider={provider} label={label} accounts={accounts} preselected={preselected} />
      )}
    </>
  );
}
