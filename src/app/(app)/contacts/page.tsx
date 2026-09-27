import { DownloadIcon } from "lucide-react";
import { ContactsView } from "@/components/crm/contacts-view";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { parseContactQuery } from "@/lib/crm-query";
import { getDb } from "@/lib/db";
import {
  contactGroupTotals,
  contactTotals,
  crmAbilities,
  crmMembers,
  ensureContactStats,
  filterOptions,
  highValueThreshold,
  listContactsPage,
  listContactViews,
  starterViewCounts,
} from "@/lib/reports-crm";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const denied = await gatePage("page.contacts");
  if (denied) return denied;
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const query = parseContactQuery(await searchParams);
  // Contacts created since the last attribution run get their roll-up row now.
  await ensureContactStats(db, ws.id);
  const highValueMinor = await highValueThreshold(db, ws);
  const q = { ...query, viewerId: user.id, highValueMinor, pii: user.can("contacts.pii") };
  const [page, totals, groups, counts, options, members, views] = await Promise.all([
    listContactsPage(db, ws, q, user),
    contactTotals(db, ws, q),
    query.group ? contactGroupTotals(db, ws, q) : Promise.resolve(null),
    starterViewCounts(db, ws, highValueMinor),
    filterOptions(db, ws),
    crmMembers(db, ws),
    listContactViews(db, ws, user.id),
  ]);
  const abilities = crmAbilities(user);
  const exportParams = new URLSearchParams(Object.entries({ q: query.q, lifecycle: query.lc ?? (query.view === "customers" ? "customer" : query.view === "leads" ? "lead" : "") }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader title="Contacts" description="Every lead and customer, with the ad that brought them in">
        {abilities.export && counts.all > 0 ? (
          <Button variant="outline" size="sm" render={<a href={`/api/v1/exports/contacts${exportParams.size ? `?${exportParams}` : ""}`} download />}>
            <DownloadIcon /> <span className="max-sm:sr-only">Export CSV</span>
          </Button>
        ) : null}
      </PageHeader>
      <PageBody>
        <ContactsView
          query={query}
          rows={page.rows}
          nextCursor={page.nextCursor}
          prevCursor={page.prevCursor}
          totals={totals}
          groups={groups}
          counts={counts}
          views={views}
          options={options}
          members={members}
          abilities={abilities}
          viewerId={user.id}
          currency={ws.reportingCurrency}
          timezone={ws.timezone}
          now={new Date().toISOString()}
          highValueMinor={highValueMinor}
          canSetup={user.can("workspace.settings")}
        />
      </PageBody>
    </>
  );
}
