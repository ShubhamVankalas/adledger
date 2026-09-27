import Link from "next/link";
import { UnitEconomicsForm } from "@/components/profit/unit-economics-form";
import { ReadOnlyNotice, SettingsHeader } from "@/components/settings/section";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { toDecimalString } from "@/lib/money";
import { bpsToPercent, getUnitEconomics } from "@/lib/reports-profit";

export const metadata = { title: "Profit settings" };

export default async function ProfitSettingsPage() {
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const canEdit = user.can("workspace.settings");
  const ue = await getUnitEconomics(await getDb(), ws.id);
  const c = ws.reportingCurrency;
  const initial = ue.configured
    ? {
        cogsPct: bpsToPercent(10_000 - ue.grossMarginBps),
        feePct: bpsToPercent(ue.feeBps),
        feeFixed: ue.feeFixedMinor ? toDecimalString(ue.feeFixedMinor, c) : "",
        shipping: ue.shippingPerOrderMinor ? toDecimalString(ue.shippingPerOrderMinor, c) : "",
      }
    : { cogsPct: "", feePct: "", feeFixed: "", shipping: "" };

  return (
    <>
      <SettingsHeader
        title="Profit"
        description={`Your costs per sale, in ${c}. AdLedger uses them to turn revenue into contribution, POAS and profit per ad, on the Profit page and on every receipt.`}
      />
      {!canEdit ? <ReadOnlyNotice what="unit economics" /> : null}
      <Card>
        <CardContent className="space-y-4">
          <UnitEconomicsForm key={ue.updatedAt ?? "new"} initial={initial} configured={ue.configured} currency={c} canEdit={canEdit} />
          <p className="border-t pt-3 text-caption text-pretty text-muted-foreground" suppressHydrationWarning>
            {ue.configured && ue.updatedAt ? `Last changed ${timeAgo(ue.updatedAt)}. ` : ""}
            Changes apply to every period, past ones included. Refunds are already taken out of revenue, so don&rsquo;t include them here.{" "}
            <Link href="/profit" className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
              Open the Profit page
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
