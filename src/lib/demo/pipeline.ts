import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DB } from "../db";
import { defaultStage, listStages } from "../pipeline";
import { DAY, parseDate } from "./world";

// Places demo contacts along the pipeline so the board, rotting and funnel tell a story.
// Customers are already in Won (their first payment moved them there during the Stripe sync);
// this spreads the remaining leads over the open stages and Lost, with a believable history.
// Deterministic for a given contact email.

/** Stable numbers in [0, 1) derived from a key. */
function unit(key: string, i: number) {
  const h = createHash("sha256").update(`${key}:${i}`).digest();
  return h.readUInt32BE(0) / 2 ** 32;
}

export async function seedDemoPipeline(db: DB, workspaceId: string, anchor: string) {
  const stages = await listStages(db, workspaceId);
  const open = stages.filter((s) => s.kind === "open");
  const lost = stages.find((s) => s.kind === "lost");
  const def = defaultStage(stages);
  const won = new Set(stages.filter((s) => s.kind === "won").map((s) => s.id));
  const end = Math.min(Date.now(), parseDate(anchor).getTime() + DAY - 1);

  const contacts = await db
    .select({ id: schema.contacts.id, email: schema.contacts.email, stageId: schema.contacts.stageId, firstSeenAt: schema.contacts.firstSeenAt })
    .from(schema.contacts)
    .where(eq(schema.contacts.workspaceId, workspaceId));

  const updates: { id: string; stageId: string; at: Date }[] = [];
  const events: (typeof schema.contactStageEvents.$inferInsert)[] = [];
  for (const c of contacts) {
    if (c.stageId && won.has(c.stageId)) continue;
    const key = c.email ?? c.id;
    const start = c.firstSeenAt.getTime();
    const ageDays = Math.max(0, (end - start) / DAY);
    // How far along the open stages this lead got: half stay new, a few reach a proposal.
    const u = unit(key, 1);
    const furthest = Math.min(open.length - 1, u < 0.5 ? 0 : u < 0.72 ? 1 : u < 0.88 ? 2 : 3);
    const lostChance = ageDays > 30 ? 0.6 : ageDays > 14 ? 0.3 : 0.04;
    const isLost = Boolean(lost) && unit(key, 2) < lostChance;
    // The last open stage was entered 0–18 days ago (some fresh, some rotting), never before the lead.
    const lastOpenAt = Math.max(start, end - unit(key, 3) * Math.min(ageDays, 18) * DAY);
    const path = open.slice(0, furthest + 1);
    let prev = def;
    let at = start;
    for (let i = 1; i < path.length; i++) {
      at = start + ((lastOpenAt - start) * i) / (path.length - 1);
      events.push({ workspaceId, contactId: c.id, fromStageId: prev.id, toStageId: path[i].id, fromName: prev.name, toName: path[i].name, source: "manual", occurredAt: new Date(at) });
      prev = path[i];
    }
    if (isLost && lost) {
      at = Math.max(at, lastOpenAt) + unit(key, 4) * Math.max(0, end - Math.max(at, lastOpenAt));
      events.push({ workspaceId, contactId: c.id, fromStageId: prev.id, toStageId: lost.id, fromName: prev.name, toName: lost.name, source: "manual", occurredAt: new Date(at) });
      prev = lost;
    }
    if (prev.id !== def.id) updates.push({ id: c.id, stageId: prev.id, at: new Date(at) });
    else updates.push({ id: c.id, stageId: def.id, at: new Date(start) });
  }

  for (let i = 0; i < events.length; i += 1000) {
    await db.insert(schema.contactStageEvents).values(events.slice(i, i + 1000));
  }
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const values = sql.join(
      chunk.map((u) => sql`(${u.id}::uuid, ${u.stageId}::uuid, ${u.at.toISOString()}::timestamptz)`),
      sql`, `,
    );
    await db.execute(sql`
      update contacts c set stage_id = v.stage_id, stage_changed_at = v.at
      from (values ${values}) as v(id, stage_id, at)
      where c.id = v.id and c.workspace_id = ${workspaceId}`);
  }
  return { moved: updates.filter((u) => u.stageId !== def.id).length, events: events.length };
}
