"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { guessMapping, mappingWarning, parseMapping, previewContactsImport, readContactsCsv, runContactsImport, type ContactsTable } from "@/lib/contacts-import";
import { dismissDuplicate, MergeError, mergeContacts } from "@/lib/contacts-merge";

// Data hygiene: contacts CSV import (Settings → Import data) and duplicate review + merge
// (Settings → Import data → Duplicates). Importing needs workspace.settings; merging deletes a
// contact record, so it needs workspace.data, like erasure.

const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readTable(form: FormData): Promise<ContactsTable> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file first.");
  if (file.size > MAX_BYTES) throw new Error("That file is over 10 MB. Split it into smaller files.");
  return readContactsCsv(await file.text());
}

function mappingFrom(form: FormData, table: ContactsTable) {
  const raw = str(form, "mapping");
  if (!raw) return guessMapping(table.headers);
  try {
    return parseMapping(JSON.parse(raw), table.headers.length);
  } catch {
    return guessMapping(table.headers);
  }
}

/** Step 2 and 3: read the file, guess (or apply) the column mapping, and count new / update / invalid. */
export async function previewContactsCsvAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const table = await readTable(form);
    const mapping = mappingFrom(form, table);
    const preview = await previewContactsImport(await getDb(), user.workspace, table, mapping);
    // Up to three example values per column, so people can recognise each one when mapping.
    const examples = table.headers.map((_, i) => table.rows.map((r) => r[i]).filter(Boolean).slice(0, 3));
    return ok(undefined, { headers: table.headers, examples, mapping, preview });
  });
}

export async function importContactsCsvAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const table = await readTable(form);
    const mapping = mappingFrom(form, table);
    const warning = mappingWarning(mapping);
    if (warning) return fail(warning);
    const result = await runContactsImport(await getDb(), user.workspace, table, mapping, {
      recordLeads: str(form, "recordLeads") === "on",
      formName: str(form, "formName") || null,
    });
    await audit(user, "import.contacts_csv", null, { ...result });
    revalidatePath("/", "layout");
    if (result.created + result.updated === 0) return fail("No contacts were imported. Every row was invalid; check the column mapping.");
    const parts = [`${result.created.toLocaleString("en-US")} new`, `${result.updated.toLocaleString("en-US")} updated`];
    if (result.invalid) parts.push(`${result.invalid.toLocaleString("en-US")} skipped`);
    return ok(`Contacts imported: ${parts.join(", ")}.`, { ...result });
  });
}

export async function mergeContactsAction(keepId: string, mergeId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    if (!UUID.test(keepId) || !UUID.test(mergeId)) return fail("One of these contacts no longer exists. Refresh the page.");
    try {
      const result = await mergeContacts(await getDb(), user.workspace, keepId, mergeId);
      await audit(user, "contact.merged", keepId, { mergedId: mergeId, moved: result.moved, emailAdded: result.emailAdded });
    } catch (err) {
      if (err instanceof MergeError) return fail(err.message);
      throw err;
    }
    revalidatePath("/settings/workspace/duplicates");
    revalidatePath("/contacts");
    return ok("Contacts merged. Attribution is being recalculated.");
  });
}

export async function dismissDuplicateAction(idA: string, idB: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    if (!UUID.test(idA) || !UUID.test(idB) || !(await dismissDuplicate(await getDb(), user.workspace, idA, idB))) {
      return fail("One of these contacts no longer exists. Refresh the page.");
    }
    await audit(user, "contact.duplicate_dismissed", null, { contacts: [idA, idB].sort() });
    revalidatePath("/settings/workspace/duplicates");
    return ok("Marked as different people.");
  });
}
