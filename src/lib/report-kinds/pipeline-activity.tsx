import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { Funnel } from "../pdf/charts";
import { Callout, Section, Stat, Table, type Column } from "../pdf/components";
import { num, pct, safeText } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { costPerStage, stageFunnel, type CostPerStageRow, type FunnelStep, type StageFunnel } from "../reports-pipeline";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Pipeline and CRM activity: the cohort of contacts first seen in the period, how far they got
// through the workspace's pipeline stages, and the ad spend behind each stage (reports-pipeline.ts).

export type PipelineActivityData = {
  funnel: StageFunnel;
  costs: { stages: { id: string; name: string }[]; rows: CostPerStageRow[] };
  won: number;
  lost: number;
  winRate: number | null;
};

/** At most this many stage columns fit the cost table on a portrait page. */
const MAX_COST_STAGES = 4;

export async function loadPipelineActivity(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<PipelineActivityData>> {
  const range = { start: req.start, end: req.end };
  const [f, costs] = await Promise.all([stageFunnel(db, ws, range), costPerStage(db, ws, { ...range, level: "campaign" })]);
  const won = f.steps.filter((s) => s.kind === "won").reduce((sum, s) => sum + s.reached, 0);
  const lost = f.steps.filter((s) => s.kind === "lost").reduce((sum, s) => sum + s.reached, 0);
  // Cost columns: the stages after the first (everyone starts there), won last, lost left out.
  const open = costs.stages.filter((s) => s.kind !== "lost");
  const picked = [...open.slice(1).filter((s) => s.kind !== "won").slice(0, MAX_COST_STAGES - 1), ...open.filter((s) => s.kind === "won").slice(0, 1)];
  return {
    funnel: f,
    costs: { stages: picked.map((s) => ({ id: s.id, name: s.name })), rows: costs.rows.filter((r) => r.spendMinor > 0).sort((a, b) => b.spendMinor - a.spendMinor) },
    won,
    lost,
    winRate: f.total > 0 ? won / f.total : null,
    methodology: await loadMethodology(db, ws, req),
  };
}

function Body({ data }: { data: ReportData<PipelineActivityData> }) {
  const W = CONTENT_WIDTH.portrait;
  const f = data.funnel;
  const m = money(f.currency);
  const flow = f.steps.filter((s) => s.kind !== "lost");
  const lostSteps = f.steps.filter((s) => s.kind === "lost");
  const wonStep = flow.find((s) => s.kind === "won");

  const stageCols: Column<FunnelStep>[] = [
    { header: "Stage", flex: 1.8, cell: (r) => r.name, sub: (r) => (r.kind === "won" ? "won" : r.kind === "lost" ? "lost" : null) },
    { header: "Reached", flex: 0.8, align: "right", cell: (r) => num(r.reached) },
    { header: "Of new contacts", flex: 1, align: "right", cell: (r) => pct(r.ofTotal) },
    { header: "From previous stage", flex: 1.1, align: "right", cell: (r) => pct(r.conversion) },
    { header: "From ads", flex: 0.8, align: "right", cell: (r) => num(r.paidReached) },
    { header: "Ad spend per contact", flex: 1.2, align: "right", cell: (r) => m.whole(r.costMinor) },
  ];
  const costCols: Column<CostPerStageRow>[] = [
    { header: "Campaign", flex: 2.4, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Spend", flex: 0.9, align: "right", cell: (r) => m.whole(r.spendMinor) },
    ...data.costs.stages.map(
      (s): Column<CostPerStageRow> => ({
        header: `Per ${safeText(s.name, 18).toLowerCase()}`,
        flex: 1,
        align: "right",
        cell: (r) => {
          const x = r.stages.find((st) => st.stageId === s.id);
          return x && x.reached > 0 ? m.whole(x.costMinor) : "—";
        },
        sub: (r) => {
          const x = r.stages.find((st) => st.stageId === s.id);
          return x && x.reached > 0 ? `${num(x.reached)} reached` : null;
        },
      }),
    ),
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="New contacts" value={num(f.total)} />
        <Stat label="Won" value={num(data.won)} tone={data.won > 0 ? C.positive : undefined} />
        <Stat label="Lost" value={num(data.lost)} />
        <Stat label="Win rate" value={pct(data.winRate)} />
        <Stat label="Ad spend" value={m.whole(f.spendMinor)} />
        <Stat label="Spend per won (ads)" value={m.whole(wonStep?.costMinor ?? null)} />
      </View>

      {f.total === 0 ? (
        <View style={{ marginTop: 14 }}>
          <Callout tone="neutral" title="No new contacts in this period">
            Contacts appear here once a lead, a payment or a CRM sync creates them. Pick a longer period or check your lead sources.
          </Callout>
        </View>
      ) : (
        <>
          <Section title="Stage funnel" aside="Contacts first seen in the period, by the furthest stage they reached">
            <Funnel width={W} steps={flow.map((s) => ({ label: safeText(s.name, 28), value: s.reached }))} format={(v) => num(v)} color={C.customers} rowHeight={22} />
            {lostSteps.some((s) => s.reached > 0) ? (
              <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 6 }}>
                {lostSteps.map((s) => `${num(s.reached)} currently in ${safeText(s.name, 28)}`).join(" · ")}
              </Text>
            ) : null}
          </Section>

          <Section title="Stage by stage">
            <Table columns={stageCols} rows={f.steps} limit={20} moreNoun="stages" dense />
          </Section>
        </>
      )}

      <Section title="Cost per stage by campaign" aside="Spend ÷ contacts whose first touch was the campaign">
        <Table columns={costCols} rows={data.costs.rows} limit={20} moreNoun="campaigns" dense emptyText="No campaign with spend brought in a new contact in this period." />
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
          Stage costs credit each contact to the campaign of their first tracked touch, whatever attribution model the rest of AdLedger uses. Contacts who later reached a stage count even if they moved there after the period.
        </Text>
      </Section>
    </View>
  );
}

export const pipelineActivity = defineReportKind<PipelineActivityData>({
  meta: REPORT_CATALOG["pipeline-activity"],
  load: loadPipelineActivity,
  Body,
});
