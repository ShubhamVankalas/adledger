import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { listContacts } from "@/lib/reports";

const q = z.object({
  search: z.string().optional(),
  lifecycle: z.enum(["lead", "customer"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = withAuth(async (req, ws) => {
  const params = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = await getDb();
  return json(await listContacts(db, ws, params));
});
