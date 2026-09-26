import { eq } from "drizzle-orm";
import { SettingsHeader } from "@/components/settings/section";
import { TrackingSection } from "@/components/settings/tracking-section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "Tracking" };

export default async function TrackingPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const [origin, sites, hooks] = await Promise.all([
    publicUrl(),
    db.select().from(schema.pixelSites).where(eq(schema.pixelSites.workspaceId, user.workspace.id)).orderBy(schema.pixelSites.createdAt),
    db.select().from(schema.leadWebhooks).where(eq(schema.leadWebhooks.workspaceId, user.workspace.id)).orderBy(schema.leadWebhooks.createdAt),
  ]);
  return (
    <>
      <SettingsHeader
        title="Tracking & forms"
        description="Install the pixel on your website and connect form tools. Using WordPress, Shopify, Webflow or another builder? See the step-by-step guides in the docs."
      />
      <TrackingSection
        origin={origin}
        sites={sites.map((s) => ({ id: s.id, name: s.name, domains: s.domains, publicKey: s.publicKey }))}
        hooks={hooks.map((h) => ({ id: h.id, name: h.name, token: h.token }))}
      />
    </>
  );
}
