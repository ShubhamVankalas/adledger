import { GoalsPacingWidget } from "@/components/goals/pacing-widget";
import { ReadOnlyNotice, SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { moneyWhole, roas, num } from "@/lib/format";
import { GOAL_METRICS, goalInputValue, goalsPacing, goalTarget, listGoals, minorToInput } from "@/lib/reports-goals";
import { GoalsEditor, type GoalRowData } from "./goals-editor";

export const metadata = { title: "Targets & goals" };

export default async function GoalsSettingsPage() {
  const user = await requireUser();
  const ws = user.workspace;
  const db = await getDb();
  const [goals, pacing] = await Promise.all([listGoals(db, ws), goalsPacing(db, ws)]);
  const canEdit = user.can("workspace.settings");

  const rows: GoalRowData[] = goals.map((g) => {
    const def = GOAL_METRICS[g.metric];
    const t = goalTarget(g);
    return {
      id: g.id,
      metric: g.metric,
      period: g.period,
      target: goalInputValue(g),
      targetLabel: t === null ? "—" : def.kind === "money" ? moneyWhole(t, g.currency) : def.kind === "ratio" ? roas(t) : num(t),
      budget: g.budgetMinor === null ? "" : minorToInput(g.budgetMinor, g.currency),
      budgetLabel: g.budgetMinor === null ? null : moneyWhole(g.budgetMinor, g.currency),
      stale: (def.kind === "money" || g.budgetMinor !== null) && g.currency !== ws.reportingCurrency,
    };
  });

  return (
    <>
      <SettingsHeader
        title="Targets & goals"
        description="Set what this workspace is aiming for each month or quarter. The Overview shows whether you’re on pace, and performance tables colour each campaign against the ROAS, MER, CAC and CPL targets."
      />
      {!canEdit ? <ReadOnlyNotice what="targets" /> : null}
      <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @4xl/settings:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <GoalsEditor goals={rows} currency={ws.reportingCurrency} canEdit={canEdit} />
        <GoalsPacingWidget data={pacing} title="Pacing preview" />
      </div>
    </>
  );
}
