"use server";

import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { getDb } from "@/lib/db";
import { isIsoDate } from "@/lib/period-presets";
import type { PerfLevel, ReportParams } from "@/lib/reports";
import { performancePeek, type PerformancePeek } from "@/lib/reports-performance";

// Read-only: loads the row peek (trend, children, contacts) for the Performance page on demand,
// so opening a peek never re-renders the whole report.

type PeekInput = {
  level: string;
  id: string;
  start: string;
  end: string;
  model: string;
  comparison?: { start: string; end: string } | null;
};

const LEVELS: PerfLevel[] = ["campaign", "ad_group", "ad"];
const MODELS: ReportParams["model"][] = ["first_touch", "last_touch", "linear"];
const MAX_DAYS = 800;

export async function loadPeekAction(input: PeekInput): Promise<ActionResult & { peek?: PerformancePeek | null }> {
  return run(async () => {
    const user = await guard("reports.view");
    const level = LEVELS.find((l) => l === input?.level);
    const model = MODELS.find((m) => m === input?.model);
    const cmp = input?.comparison;
    if (!level || !model || typeof input.id !== "string" || !isIsoDate(input.start) || !isIsoDate(input.end) || input.start > input.end) {
      return fail("That report link isn't valid.");
    }
    if (cmp && (!isIsoDate(cmp.start) || !isIsoDate(cmp.end) || cmp.start > cmp.end)) return fail("That report link isn't valid.");
    // The trend has one point per day: refuse absurd ranges instead of generating them.
    if ((Date.parse(input.end) - Date.parse(input.start)) / 86_400_000 > MAX_DAYS) return fail("Pick a shorter date range to see the trend.");
    const peek = await performancePeek(await getDb(), user.workspace, {
      level,
      id: input.id,
      start: input.start,
      end: input.end,
      model,
      comparison: cmp ? { start: cmp.start, end: cmp.end } : null,
    });
    return { ...ok(), peek };
  });
}
