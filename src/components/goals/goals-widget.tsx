import { TargetIcon } from "lucide-react";
import { CardLink, WidgetCard, WidgetEmpty } from "@/components/overview/widget-card";
import { getViewer, type DashParams } from "@/lib/dashboard/data";
import { getDb } from "@/lib/db";
import { goalsPacing } from "@/lib/reports-goals";
import { GoalRow } from "./pacing-widget";

// Overview widget #22 "Goals & pacing": month- or quarter-to-date against each workspace target.
// Always "this month / this quarter", whatever the board's date range; the model follows the board.

export async function GoalsWidget({ p }: { p: DashParams; currency?: string }) {
  const [db, user] = await Promise.all([getDb(), getViewer()]);
  const data = await goalsPacing(db, user.workspace, { model: p.model });
  const setupHref = user.can("workspace.settings") ? "/settings/workspace/goals" : null;
  const periods = new Set(data.items.map((i) => i.period));
  const description = data.items.length ? (periods.size > 1 ? "Month and quarter to date" : data.items[0].period === "quarter" ? "Quarter to date" : "Month to date") : "Progress against your targets";
  return (
    <WidgetCard title="Goals & pacing" description={description} action={setupHref && data.items.length ? <CardLink href={setupHref}>Targets</CardLink> : null} bodyClassName="overflow-y-auto">
      {data.items.length === 0 ? (
        <WidgetEmpty icon={TargetIcon} title="No targets yet" action={setupHref ? <CardLink href={setupHref}>Set targets</CardLink> : null}>
          Set a monthly revenue, lead or ROAS target to see whether you’re on pace and where the month will land.
        </WidgetEmpty>
      ) : (
        <ul className="grid">
          {data.items.map((item) => (
            <GoalRow key={item.id} item={item} currency={data.currency} />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
