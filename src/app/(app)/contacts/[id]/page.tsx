import { notFound } from "next/navigation";
import { ContactPrivacyActions } from "@/components/contact-privacy-actions";
import { contactName } from "@/components/crm/crm-format";
import { RecordPager, RecordView } from "@/components/crm/record-view";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { contactRecord, crmAbilities, crmMembers, workspaceTags } from "@/lib/reports-crm";

export const metadata = { title: "Contact" };

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const [record, members, tags] = await Promise.all([
    contactRecord(db, ws, id, user, { withNotes: user.can("contacts.notes") }),
    crmMembers(db, ws),
    workspaceTags(db, ws),
  ]);
  if (!record) notFound();
  const name = contactName(record.contact);

  return (
    <>
      <PageHeader title={name} breadcrumbs={[{ href: "/contacts", label: "Contacts" }]}>
        <RecordPager id={id} />
        <ContactPrivacyActions contactId={id} label={name} canExport={user.can("reports.export")} canDelete={user.can("workspace.data")} />
      </PageHeader>
      <PageBody>
        <RecordView
          record={record}
          members={members}
          tagSuggestions={tags.map((t) => t.tag)}
          abilities={crmAbilities(user)}
          viewerId={user.id}
          now={new Date().toISOString()}
        />
      </PageBody>
    </>
  );
}
