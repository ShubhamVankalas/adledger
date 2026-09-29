import { gatePage } from "@/components/access-denied";
import { PageBody, PageHeader } from "@/components/page-header";
import { ModelPicker } from "@/components/reports-gallery/model-picker";
import { documentModelStatus } from "@/lib/ai/document";
import { DOCUMENT_TEMPLATES } from "@/lib/ai/document-prompts";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resolvePeriodParams } from "@/lib/period";
import { AiDocumentStudio } from "./studio";

export const metadata = { title: "AI document" };

export default async function AiDocumentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const denied = await gatePage("page.reports");
  if (denied) return denied;
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const modelParam = first(sp.model);
  const model = modelParam === "first_touch" || modelParam === "last_touch" ? modelParam : "linear";
  const template = DOCUMENT_TEMPLATES.find((t) => t.id === first(sp.template))?.id ?? null;

  const [status, period] = await Promise.all([documentModelStatus(ws, db), resolvePeriodParams(db, ws, { range: "30d" })]);

  return (
    <>
      <PageHeader title="AI document" description="Describe the document you need; your AI model writes it from your ledger and AdLedger lays it out as a branded PDF." breadcrumbs={[{ href: "/reports", label: "Reports" }]}>
        <ModelPicker model={model} />
      </PageHeader>
      <PageBody>
        <AiDocumentStudio
          templates={DOCUMENT_TEMPLATES}
          initialTemplateId={template}
          anchor={period.end}
          model={model}
          modelReady={status.ready}
          modelLabel={status.label}
          canGenerate={user.can("reports.pdf") && user.can("insights.generate")}
          canConfigureAi={user.can("workspace.settings")}
        />
      </PageBody>
    </>
  );
}
