import { gatePage } from "@/components/access-denied";
import { DevelopersTabs } from "@/components/developers/developers-tabs";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { DEVELOPER_TABS } from "@/lib/developers";

// Developers: API keys, outbound webhooks, the API reference and recipes. Admin-only by default
// (page.developers); each page gates itself too, since a layout doesn't stop its page rendering.

export default async function DevelopersLayout({ children }: { children: React.ReactNode }) {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  const tabs = DEVELOPER_TABS.filter((t) => !t.permission || user.can(t.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <>
      <PageHeader title="Developers" description="Connect AdLedger to your own tools: REST API, webhooks and ready-made recipes" />
      <PageBody>
        <DevelopersTabs tabs={tabs} />
        {children}
      </PageBody>
    </>
  );
}
