import { audit, requestContext } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { json } from "@/lib/http";
import { csvCell, textStream } from "@/lib/privacy";
import { authorize, downloadName } from "@/lib/request-auth";
import { AUDIT_LABELS, auditCursor, auditWhere, parseAuditFilters, targetNames } from "@/lib/security/audit-query";
import { desc, eq } from "drizzle-orm";

// GET /api/v1/exports/audit?category=&member=&workspace=&period= — the audit log (with the page's
// filters) as CSV, including each entry's hash so the chain can be checked outside AdLedger.
// Dashboard only: members with audit.view and export.csv (owners and admins).

const COLUMNS = ["seq", "time_utc", "actor", "actor_id", "action", "description", "target", "workspace_id", "ip_trunc", "user_agent", "meta", "prev_hash", "hash"];
const PAGE = 1000;

export async function GET(req: Request) {
  const auth = await authorize(req, "audit.view", { sessionOnly: true });
  if (auth instanceof Response) return auth;
  const caller = auth;
  if (!caller.can("export.csv")) return json({ error: "forbidden", hint: "Your role can't download CSV exports." }, 403);
  const base = { ...parseAuditFilters(new URL(req.url).searchParams), before: null };
  const orgId = caller.actor.organizationId;
  const db = await getDb();
  const context = await requestContext();
  let rows = 0;
  async function* csv() {
    try {
      yield `${COLUMNS.join(",")}\r\n`;
      let before: string | null = null;
      for (;;) {
        const page = await db
          .select({ log: schema.auditLog, name: schema.users.name })
          .from(schema.auditLog)
          .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
          .where(auditWhere(orgId, { ...base, before }))
          .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
          .limit(PAGE);
        if (page.length === 0) return;
        const names = await targetNames(db, page);
        yield page
          .map(({ log, name }) =>
            [
              log.seq,
              log.createdAt.toISOString(),
              name ?? (log.userId ? "former member" : "system"),
              log.userId,
              log.action,
              AUDIT_LABELS[log.action] ?? "",
              log.target && names.has(log.target) ? names.get(log.target) : log.target,
              log.workspaceId,
              log.ipTrunc,
              log.userAgent,
              JSON.stringify(log.meta ?? {}),
              log.prevHash,
              log.hash,
            ]
              .map((v) => csvCell(v ?? null))
              .join(",") + "\r\n",
          )
          .join("");
        rows += page.length;
        if (page.length < PAGE) return;
        before = auditCursor(page.at(-1)!.log);
      }
    } finally {
      await audit(caller.actor, "audit.exported", null, { rows, filtered: Boolean(base.category || base.member || base.workspace) || base.period !== "90d" }, context);
    }
  }
  return new Response(textStream(csv()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, "audit-log", "csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
