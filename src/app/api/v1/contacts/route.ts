import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { listContacts } from "@/lib/reports";
import { canSeePii, maskRows } from "@/lib/security/pii";

const q = z.object({
  search: z.string().optional(),
  lifecycle: z.enum(["lead", "customer"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /api/v1/contacts — emails are masked unless the member may see contact PII (contacts.pii)
// or the API key carries contacts:pii. Without it, search matches names and exact emails only.
export const GET = withAuth(
  async (req, ws, _ctx, principal) => {
    const params = q.parse(Object.fromEntries(new URL(req.url).searchParams));
    const pii = canSeePii(principal);
    const db = await getDb();
    const result = await listContacts(db, ws, { ...params, piiSearch: pii });
    return json({ ...result, rows: maskRows(result.rows, pii), emailsMasked: !pii });
  },
  { permission: "reports.view", scope: "contacts:read" },
);
