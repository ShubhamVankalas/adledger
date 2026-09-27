import { notFound } from "next/navigation";
import { ContactPrivacyActions } from "@/components/contact-privacy-actions";
import { contactName } from "@/components/crm/crm-format";
import { RecordPager, RecordView } from "@/components/crm/record-view";
import { PageBody, PageHeader } from "@/components/page-header";
import { ContactStagePill } from "@/components/pipeline/contact-stage";
import { ContactReceiptView } from "@/components/receipts/receipt";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { AttributionModel } from "@/lib/db/schema";
import { contactStage } from "@/lib/pipeline";
import { contactRecord, crmAbilities, crmMembers, workspaceTags } from "@/lib/reports-crm";
import { contactReceipt, parseCostBasis } from "@/lib/reports-profit";
import { gatePage } from "@/components/access-denied";

const MODELS: AttributionModel[] = ["linear", "first_touch", "last_touch"];

export const metadata = { title: "Contact" };

export default async function ContactPage({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const denied = await gatePage("page.contacts");
  if (denied) return denied;
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const model = (MODELS.includes(sp.model as AttributionModel) ? sp.model : "linear") as AttributionModel;
  const [record, members, tags, stage, receipt] = await Promise.all([
    contactRecord(db, ws, id, user, { withNotes: user.can("contacts.notes") }),
    crmMembers(db, ws),
    workspaceTags(db, ws),
    contactStage(db, ws.id, id),
    user.can("reports.view") ? contactReceipt(db, ws, id, model, { revealEmail: user.can("contacts.pii"), basis: parseCostBasis(sp.cost) }) : null,
  ]);
  if (!record) notFound();
  const name = contactName(record.contact);

  return (
    <>
      <PageHeader title={name} breadcrumbs={[{ href: "/contacts", label: "Contacts" }]}>
        <RecordPager id={id} />
        <ContactPrivacyActions contactId={id} label={name} canExport={user.can("export.contacts")} canDelete={user.can("workspace.data")} />
      </PageHeader>
      <PageBody>
        <RecordView
          record={record}
          members={members}
          tagSuggestions={tags.map((t) => t.tag)}
          abilities={crmAbilities(user)}
          viewerId={user.id}
          now={new Date().toISOString()}
          stage={stage ? <ContactStagePill contactId={id} label={name} stageId={stage.stageId} stages={stage.stages} canMove={user.can("pipeline.move")} /> : null}
          receipt={receipt ? <ContactReceiptView receipt={receipt} timeZone={ws.timezone} /> : null}
        />
      </PageBody>
    </>
  );
}
