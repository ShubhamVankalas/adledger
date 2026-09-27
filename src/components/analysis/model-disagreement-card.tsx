import { ScaleIcon } from "lucide-react";
import { getDb } from "@/lib/db";
import { moneyShort, num, pct } from "@/lib/format";
import type { ReportParams } from "@/lib/reports";
import { modelDisagreement } from "@/lib/reports-analysis";
import type { Workspace } from "@/lib/settings";
import { Dumbbell, DumbbellLegend } from "./dumbbell";
import { Num, Panel, PanelEmpty } from "./primitives";

/**
 * "How much does the model matter?" for the Attribution → Models tab: the revenue that moves
 * between first touch, last touch and linear, and a dumbbell per campaign (largest spread first).
 */
export async function ModelDisagreementCard({ ws, p, limit = 10 }: { ws: Workspace; p: ReportParams; limit?: number }) {
  const r = await modelDisagreement(await getDb(), ws, p);
  const c = r.currency;
  const moving = r.rows.filter((x) => x.spreadMinor > 0).length;
  return (
    <Panel
      id="model-disagreement"
      title="Where the models disagree"
      description={
        r.rows.length === 0 ? (
          "Revenue each campaign earns under each attribution model."
        ) : (
          <>
            <Num>{moneyShort(r.movableMinor, c)}</Num>
            {r.movableShare !== null ? <> ({pct(r.movableShare, 0)})</> : null} of campaign revenue changes hands depending on the model, across{" "}
            {num(moving)} {moving === 1 ? "campaign" : "campaigns"}. A long line means the model you pick decides whether the campaign looks good.
          </>
        )
      }
      action={r.rows.length ? <DumbbellLegend /> : undefined}
    >
      {r.rows.length === 0 ? (
        <PanelEmpty icon={ScaleIcon} title="No campaign revenue in this period">
          Once customers who clicked an ad pay, each campaign gets a dot per model here.
        </PanelEmpty>
      ) : (
        <>
          <Dumbbell report={r} currency={c} limit={limit} />
          {r.rows.length > limit ? (
            <p className="mt-3 border-t pt-3 text-caption text-muted-foreground">
              Showing the {limit} campaigns the model moves most, of {num(r.rows.length)}. The table below lists every campaign.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
