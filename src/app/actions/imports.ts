"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { importConversions, importSpend, normalizeDate, parseCsv } from "@/lib/imports";

const MAX_BYTES = 10 * 1024 * 1024;

async function readCsv(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file first.");
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Split it into smaller files.");
  return parseCsv(await file.text());
}

export async function importSpendCsvAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const rows = await readCsv(form);
    if (rows.length === 0) return fail("No rows found. The first line must be a header row.");
    const db = await getDb();
    const result = await importSpend(
      db,
      user.workspace,
      rows.map((r) => ({ ...r, date: normalizeDate(r.date ?? ""), platform: r.platform || String(form.get("platform") || "other") })) as never[],
    );
    await audit(user, "import.spend_csv", null, { rows: result.rows, errors: result.errors.length });
    revalidatePath("/", "layout");
    if (result.rows === 0) return fail(result.errors[0] ?? "Nothing was imported.");
    return ok(`Imported ${result.rows.toLocaleString()} spend rows${result.errors.length ? `, skipped ${result.errors.length} (first: ${result.errors[0]})` : ""}.`);
  });
}

export async function importRevenueCsvAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const rows = await readCsv(form);
    if (rows.length === 0) return fail("No rows found. The first line must be a header row.");
    const db = await getDb();
    const events = rows.map((r) => {
      const at = r.occurred_at || r.date || "";
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(at)) && at.length <= 10 ? `${normalizeDate(at)}T12:00:00Z` : at;
      return { ...r, type: (r.type || "payment").toLowerCase(), occurred_at: iso || undefined, source: r.source || "csv" };
    });
    const result = await importConversions(db, user.workspace, events as never[], "csv");
    await audit(user, "import.revenue_csv", null, { revenue: result.revenue, leads: result.leads, errors: result.errors.length });
    revalidatePath("/", "layout");
    const stored = result.revenue + result.leads;
    if (stored === 0) return fail(result.errors[0] ?? "Nothing was imported.");
    return ok(`Imported ${result.revenue} payments/refunds and ${result.leads} leads${result.errors.length ? `, skipped ${result.errors.length} (first: ${result.errors[0]})` : ""}.`);
  });
}
