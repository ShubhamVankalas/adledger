import { desc, eq } from "drizzle-orm";
import { FileCheck2Icon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { ModelPicker } from "@/components/reports-gallery/model-picker";
import { ReportGallery } from "@/components/reports-gallery/report-gallery";
import { SchedulesList, type ScheduleRow } from "@/components/reports-gallery/schedules-list";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { resolvePeriodParams } from "@/lib/period";
import { REPORT_CATALOG, REPORT_LIST, isReportKindId } from "@/lib/report-kinds/catalog";
import { cadenceLabel, scheduleRecipients } from "@/lib/report-kinds/schedule-rules";
import { getConnection } from "@/lib/settings";

export const metadata = { title: "Reports" };

function SectionTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 id={id} className="text-xs font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {aside}
    </div>
  );
}

const shortDateTime = (d: Date, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace("Sept", "Sep");
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const modelParam = Array.isArray(sp.model) ? sp.model[0] : sp.model;
  const model = modelParam === "first_touch" || modelParam === "last_touch" ? modelParam : "linear";
  const canPdf = user.can("reports.pdf");
  const canSchedule = user.can("reports.schedule");

  const [period, schedules, members, emailConn] = await Promise.all([
    resolvePeriodParams(db, ws, { range: "7d" }),
    canSchedule ? db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.workspaceId, ws.id)).orderBy(desc(schema.reportSchedules.createdAt)) : Promise.resolve([]),
    canSchedule ? scheduleRecipients(db, ws, { recipients: { all: true, userIds: [] } }) : Promise.resolve([]),
    canSchedule ? getConnection(ws.id, "notify_email", db) : Promise.resolve(undefined),
  ]);
  const emailReady = Boolean(emailConn?.enabled) || Boolean(process.env.SMTP_URL);

  const rows: ScheduleRow[] = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    reportTitle: isReportKindId(s.reportKind) ? REPORT_CATALOG[s.reportKind].title : s.reportKind,
    cadence: cadenceLabel(s),
    recipients: s.recipients.all ? "everyone in the workspace" : `${s.recipients.userIds.length} ${s.recipients.userIds.length === 1 ? "person" : "people"}`,
    enabled: s.enabled,
    lastStatus: s.lastStatus ?? null,
    lastError: s.lastError,
    lastRun: s.lastRunAt ? shortDateTime(s.lastRunAt, ws.timezone) : null,
  }));

  return (
    <>
      <PageHeader title="Reports" description="Branded PDF reports from your ledger. Download one now, or email it to your team on a schedule.">
        <ModelPicker model={model} />
      </PageHeader>
      <PageBody>
        <section aria-labelledby="library-title" className="space-y-4">
          <SectionTitle id="library-title">Report library</SectionTitle>
          {!canPdf ? (
            <p className="rounded-lg bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground">Your role can view reports on screen. Ask an admin if you need to download PDFs.</p>
          ) : null}
          <ReportGallery
            reports={REPORT_LIST}
            anchor={period.end}
            model={model}
            timezone={ws.timezone}
            canPdf={canPdf}
            canSchedule={canSchedule}
            members={members.map((m) => ({ id: m.userId, name: m.name, email: m.email }))}
            currentUserId={user.id}
            emailReady={emailReady}
            canConfigureEmail={user.can("workspace.settings")}
          />
        </section>

        {canSchedule ? (
          <section aria-labelledby="schedules-title" className="space-y-4 pt-4">
            <SectionTitle id="schedules-title" aside={<span className="text-xs text-muted-foreground">Times in {ws.timezone}</span>}>
              Scheduled deliveries
            </SectionTitle>
            <SchedulesList rows={rows} />
          </section>
        ) : null}

        <aside className="flex flex-col gap-3 border-t pt-5 text-[13px] leading-5 text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
          <p className="flex max-w-2xl gap-2.5 text-pretty">
            <FileCheck2Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>
              Every PDF is computed by SQL from your ledger, carries a fingerprint and the name of the person it was prepared for, and is recorded in the export log. Anyone holding a copy can check it on the{" "}
              <Link href="/verify" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
                verify page
              </Link>
              .
            </span>
          </p>
          <p className="shrink-0 sm:text-right">Press Ctrl+P on any dashboard page for a quick printout.</p>
        </aside>
      </PageBody>
    </>
  );
}
