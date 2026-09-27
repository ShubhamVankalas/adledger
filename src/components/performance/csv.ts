import { toMajor } from "@/lib/money";
import type { PerfRowV2 } from "@/lib/reports-performance";

// CSV export of the Performance table. The columns are unchanged from v1 on purpose (people have
// spreadsheets and scripts that read this file): exact credited counts, amounts in major units.

export const CSV_HEAD = ["name", "platform", "parent", "spend", "impressions", "clicks", "leads", "customers", "revenue", "roas", "cpl", "cac", "currency"];

const esc = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function performanceCsv(rows: PerfRowV2[], currency: string): string {
  const lines = rows.map((r) =>
    [
      r.name,
      r.platform,
      r.parentName,
      toMajor(r.spendMinor ?? 0, currency),
      r.impressions,
      r.clicks,
      r.leads,
      r.customers,
      toMajor(r.revenueMinor ?? 0, currency),
      r.roas === null ? "" : r.roas.toFixed(4),
      r.cplMinor === null ? "" : toMajor(r.cplMinor, currency),
      r.cacMinor === null ? "" : toMajor(r.cacMinor, currency),
      currency,
    ]
      .map(esc)
      .join(","),
  );
  return [CSV_HEAD.join(","), ...lines].join("\n");
}

export function downloadCsv(text: string, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
