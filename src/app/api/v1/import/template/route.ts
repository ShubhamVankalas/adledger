import { REVENUE_TEMPLATE, SPEND_TEMPLATE } from "@/lib/imports";

// GET /api/v1/import/template?kind=spend|revenue — example CSV files for Settings → Import data.
export function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") === "revenue" ? "revenue" : "spend";
  return new Response(kind === "revenue" ? REVENUE_TEMPLATE : SPEND_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="adledger-${kind}-template.csv"`,
    },
  });
}
