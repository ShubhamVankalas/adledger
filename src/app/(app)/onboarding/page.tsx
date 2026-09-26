import { eq } from "drizzle-orm";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getSetupStatus } from "@/components/onboarding";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { allIntegrations } from "@/lib/connectors/registry";
import { randomToken } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { getConnection } from "@/lib/settings";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "Setup checklist" };

export default async function OnboardingPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const ws = user.workspace;
  // Every workspace gets a pixel site automatically so the snippet is ready to copy.
  let [site] = await db.select().from(schema.pixelSites).where(eq(schema.pixelSites.workspaceId, ws.id)).limit(1);
  if (!site) {
    [site] = await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "My website", domains: "", publicKey: `pk_${randomToken(12)}` }).returning();
  }
  let [hook] = await db.select().from(schema.leadWebhooks).where(eq(schema.leadWebhooks.workspaceId, ws.id)).limit(1);
  if (!hook) {
    [hook] = await db.insert(schema.leadWebhooks).values({ workspaceId: ws.id, name: "Form tools", token: `lw_${randomToken(18)}`, fieldMapping: {} }).returning();
  }
  const [status, origin] = await Promise.all([getSetupStatus(db, ws), publicUrl()]);
  const catalog = allIntegrations().filter((i) => i.category === "ads" || i.category === "revenue");
  const connected: string[] = [];
  for (const i of catalog) if (await getConnection(ws.id, i.provider, db)) connected.push(i.provider);

  return (
    <>
      <PageHeader title="Setup checklist" description={`Get ${ws.name} tracking real results in about 15 minutes`} />
      <PageBody>
        <OnboardingWizard
          origin={origin}
          siteKey={site.publicKey}
          leadWebhookUrl={`${origin}/api/v1/webhooks/leads/${hook.token}`}
          status={status}
          picked={ws.onboarding.platforms ?? []}
          integrations={catalog.map((i) => ({ provider: i.provider, name: i.name, category: i.category, color: i.color, status: i.status }))}
          connected={connected}
        />
      </PageBody>
    </>
  );
}
