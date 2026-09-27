"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { fromDecimalString } from "@/lib/money";
import { bpsToPercent, clearUnitEconomics, parsePercent, saveUnitEconomics } from "@/lib/reports-profit";

// Settings → Workspace → Profit: the unit economics behind contribution, POAS and profit per ad.

const MONEY_RE = /^\d{1,9}([.,]\d{1,3})?$/;

/** "" → 0; "4.50" → 450 (USD); null when it isn't a plain non-negative amount. */
function amount(raw: string, currency: string): number | null {
  if (raw === "") return 0;
  if (!MONEY_RE.test(raw)) return null;
  try {
    return fromDecimalString(raw.replace(",", "."), currency);
  } catch {
    return null;
  }
}

export async function saveUnitEconomicsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const currency = user.workspace.reportingCurrency;
    const cogs = parsePercent(str(form, "cogsPct") || "0");
    const fee = parsePercent(str(form, "feePct") || "0");
    const feeFixed = amount(str(form, "feeFixed"), currency);
    const shipping = amount(str(form, "shipping"), currency);
    if (cogs === null) return fail("Enter cost of goods as a percentage between 0 and 100, like 35 or 42.5.");
    if (fee === null) return fail("Enter the payment fee as a percentage between 0 and 100, like 2.9.");
    if (feeFixed === null) return fail(`Enter the fixed fee per payment as an amount in ${currency}, like 0.30.`);
    if (shipping === null) return fail(`Enter shipping per order as an amount in ${currency}, like 4.50, or 0.`);
    const db = await getDb();
    await saveUnitEconomics(db, user.workspace.id, { grossMarginBps: 10_000 - cogs, feeBps: fee, feeFixedMinor: feeFixed, shippingPerOrderMinor: shipping });
    await audit(user, "unit_economics.updated", null, {
      cogsPct: bpsToPercent(cogs),
      feePct: bpsToPercent(fee),
      feeFixedMinor: feeFixed,
      shippingPerOrderMinor: shipping,
    });
    revalidatePath("/profit", "layout");
    revalidatePath("/settings/workspace/profit");
    return ok("Unit economics saved. Profit, POAS and receipts now use them.");
  });
}

export async function clearUnitEconomicsAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    await clearUnitEconomics(db, user.workspace.id);
    await audit(user, "unit_economics.cleared");
    revalidatePath("/profit", "layout");
    revalidatePath("/settings/workspace/profit");
    return ok("Unit economics cleared. Contribution now equals revenue.");
  });
}
