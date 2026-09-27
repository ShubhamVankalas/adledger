import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { hashEmail, hashPhone, sha256 } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { guessMapping, parseMapping, previewContactsImport, readContactsCsv, runContactsImport } from "@/lib/contacts-import";
import { dismissDuplicate, findDuplicates, mergeContacts, suggestKeep } from "@/lib/contacts-merge";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { previewContactsCsvAction, importContactsCsvAction, mergeContactsAction, dismissDuplicateAction } = await import("@/app/actions/hygiene");

let db: DB;
let ws: Workspace;
let other: Workspace;
let orgId: string;
const NOW = new Date("2026-09-20T12:00:00Z");

async function member(role: "owner" | "admin" | "analyst" | "viewer") {
  const [user] = await db.insert(schema.users).values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: ws.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

function csvForm(csv: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

async function contact(email: string | null, phone: string | null, name: string | null, target = ws) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: target.id, email, emailHash: email ? hashEmail(email) : null, phoneHash: phone ? hashPhone(phone) : null, name, firstSeenAt: new Date("2026-08-01T00:00:00Z") })
    .returning();
  return c;
}

const countContacts = async (target = ws) =>
  Number(rows<{ n: string }>(await db.execute(sql`select count(*) n from contacts where workspace_id = ${target.id}`))[0].n);

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  const [o] = await db.insert(schema.workspaces).values({ organizationId: org.id, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  other = o as Workspace;
});

describe("column mapping", () => {
  it("guesses common exports (Mailchimp, HubSpot, Shopify)", () => {
    expect(guessMapping(["Email Address", "First Name", "Last Name", "Phone Number", "Created At"])).toEqual({ email: 0, first_name: 1, last_name: 2, phone: 3, first_seen: 4 });
    expect(guessMapping(["﻿customer_name", "Billing Email", "Mobile"])).toEqual({ name: 0, email: 1, phone: 2 });
    expect(guessMapping(["Full name", "First name", "email"])).toEqual({ name: 0, email: 2 });
    expect(guessMapping(["sku", "qty"])).toEqual({});
  });

  it("ignores mappings that point outside the file or reuse a column", () => {
    expect(parseMapping({ email: 0, phone: 0, name: 7, first_seen: -1, bogus: 1 }, 3)).toEqual({ email: 0 });
    expect(parseMapping("nope", 3)).toEqual({});
  });
});

describe("contacts import", () => {
  const CSV = [
    "Email,Name,Phone,Signed up",
    "ana@acme.test,Ana Lima,,2026-03-02", // existing contact: update
    "BEN@acme.test,Ben Ode,+1 415 555 0101,03/05/2026", // new
    "ben@acme.test,,+1 415 555 0101,2026-01-15", // repeat of Ben: folds in, earlier date wins
    ",Cara Diaz,+44 7700 900123,", // phone-only, new
    "not-an-email,Dee,,", // invalid email
    ",No Contact,,", // invalid: no email or phone
    "eve@acme.test,Eve,12,", // invalid phone
    "fay@acme.test,Fay,,31/31/2026", // invalid date
    ",Gus,+1 212 555 0199,2026-04-01", // phone-only, matches an existing phone: update
  ].join("\n");

  it("previews new, update and invalid counts without writing anything", async () => {
    await contact("ana@acme.test", null, null);
    await contact(null, "+1 (212) 555-0199", "Gus");
    await contact("zed@elsewhere.test", null, null, other); // another workspace: must not count as an update
    const before = await countContacts();
    const table = readContactsCsv(CSV);
    const mapping = guessMapping(table.headers);
    expect(mapping).toEqual({ email: 0, name: 1, phone: 2, first_seen: 3 });
    const p = await previewContactsImport(db, ws, table, mapping, NOW);
    expect(p).toMatchObject({ rows: 9, new: 2, update: 2, invalid: 4, repeats: 1, warning: null });
    expect(p.problems.map((x) => x.line)).toEqual([6, 7, 8, 9]);
    expect(p.problems[0].reason).toMatch(/email/);
    expect(p.sample.find((s) => s.email === "ben@acme.test")).toMatchObject({ status: "new", firstSeen: "2026-01-15", hasPhone: true });
    expect(await countContacts()).toBe(before);
  });

  it("warns when no email or phone column is mapped", async () => {
    const table = readContactsCsv(CSV);
    const p = await previewContactsImport(db, ws, table, { name: 1 }, NOW);
    expect(p.warning).toMatch(/email address or phone/);
    expect(p.invalid).toBe(9);
    await expect(runContactsImport(db, ws, table, { name: 1 })).rejects.toThrow(/email address or phone/);
  });

  it("imports, fills blanks without overwriting, and records leads for new people only", async () => {
    const table = readContactsCsv(CSV);
    const r = await runContactsImport(db, ws, table, guessMapping(table.headers), { recordLeads: true, formName: "Old CRM", now: NOW });
    expect(r).toEqual({ created: 2, updated: 2, invalid: 4, repeats: 1, leads: 2 });

    const [ana] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.emailHash, hashEmail("ana@acme.test"))));
    expect(ana).toMatchObject({ name: "Ana Lima", firstSeenAt: new Date("2026-03-02T12:00:00Z") });
    const [ben] = await db.select().from(schema.contacts).where(eq(schema.contacts.emailHash, hashEmail("ben@acme.test")));
    expect(ben).toMatchObject({ email: "ben@acme.test", name: "Ben Ode", phoneHash: hashPhone("+14155550101"), firstSeenAt: new Date("2026-01-15T12:00:00Z") });
    const [gus] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.phoneHash, hashPhone("+12125550199"))));
    expect(gus.name).toBe("Gus"); // kept, not overwritten
    expect(gus.firstSeenAt).toEqual(new Date("2026-04-01T12:00:00Z")); // earlier than the stored 1 Aug

    const leads = await db.select().from(schema.leads).where(eq(schema.leads.workspaceId, ws.id));
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.source === "csv" && l.formName === "Old CRM")).toBe(true);
    expect(leads.map((l) => l.contactId).sort()).toEqual([ben.id, (await db.select().from(schema.contacts).where(eq(schema.contacts.phoneHash, hashPhone("+447700900123"))))[0].id].sort());
    // Only the contacts table holds the raw email.
    expect(JSON.stringify(leads)).not.toContain("@acme.test");
  });

  it("is idempotent: a second run only updates", async () => {
    const before = await countContacts();
    const table = readContactsCsv(CSV);
    const r = await runContactsImport(db, ws, table, guessMapping(table.headers), { recordLeads: true, now: NOW });
    expect(r).toMatchObject({ created: 0, updated: 4, leads: 0 });
    expect(await countContacts()).toBe(before);
    expect(await countContacts(other)).toBe(1);
  });

  it("previews a 5,000-row file with correct counts", async () => {
    const lines = ["email,name"];
    for (let i = 0; i < 5000; i++) lines.push(i % 50 === 0 ? `broken-${i},Bad` : i % 10 === 0 ? `ana@acme.test,Ana` : `bulk${i}@example.test,Person ${i}`);
    const table = readContactsCsv(lines.join("\r\n"));
    const started = performance.now();
    const p = await previewContactsImport(db, ws, table, guessMapping(table.headers), NOW);
    expect(performance.now() - started).toBeLessThan(5000);
    // 100 broken (every 50th), 400 more Ana rows (every 10th but not 50th) fold into one update.
    expect(p).toMatchObject({ rows: 5000, invalid: 100, update: 1, repeats: 399, new: 4500 });
  });
});

describe("import actions", () => {
  it("previews and imports for admins, and records an audit entry", async () => {
    session.token = await member("admin");
    const csv = "e-mail,full name\nhal@acme.test,Hal\n";
    const preview = await previewContactsCsvAction(csvForm(csv));
    expect(preview).toMatchObject({ ok: true, data: { headers: ["e-mail", "full name"], mapping: { email: 0, name: 1 }, preview: { new: 1, update: 0, invalid: 0 } } });
    const remapped = await previewContactsCsvAction(csvForm(csv, { mapping: JSON.stringify({ name: 1 }) }));
    expect(remapped).toMatchObject({ ok: true, data: { preview: { warning: expect.any(String) } } });
    const done = await importContactsCsvAction(csvForm(csv, { recordLeads: "on", formName: "Webinar" }));
    expect(done).toMatchObject({ ok: true, data: { created: 1, leads: 1 } });
    const trail = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "import.contacts_csv"));
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail[0].meta)).not.toContain("hal@");
  });

  it("refuses analysts and viewers, and empty files", async () => {
    for (const role of ["analyst", "viewer"] as const) {
      session.token = await member(role);
      expect(await previewContactsCsvAction(csvForm("email\nx@y.test\n"))).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
      expect(await importContactsCsvAction(csvForm("email\nx@y.test\n"))).toMatchObject({ ok: false });
    }
    session.token = await member("owner");
    expect(await previewContactsCsvAction(csvForm("email\n"))).toMatchObject({ ok: false, message: expect.stringMatching(/header row/) });
    expect(await importContactsCsvAction(new FormData())).toMatchObject({ ok: false, message: expect.stringMatching(/Choose a CSV/) });
    session.token = undefined;
  });
});

describe("duplicates and merge", () => {
  let merged: Workspace;
  let phoneLead: { id: string };
  let payer: { id: string };
  let visitorId: string;

  beforeAll(async () => {
    ({ ws: merged } = await setupWorkspace());
    // A WhatsApp lead: phone only, came from a Meta ad on 1 Sep.
    [phoneLead] = await db.insert(schema.contacts).values({ workspaceId: merged.id, phoneHash: hashPhone("+91 98765 43210"), name: "Priya Sharma", firstSeenAt: new Date("2026-09-01T10:00:00Z") }).returning();
    const [v] = await db.insert(schema.visitors).values({ workspaceId: merged.id, anonymousId: "vid-priya", firstSeenAt: new Date("2026-09-01T09:59:00Z"), lastSeenAt: new Date("2026-09-01T10:05:00Z"), contactId: phoneLead.id }).returning();
    visitorId = v.id;
    await db.insert(schema.touchpoints).values({ workspaceId: merged.id, visitorId: v.id, occurredAt: new Date("2026-09-01T09:59:00Z"), channel: "paid_social", platform: "meta", utmSource: "facebook" });
    await db.insert(schema.leads).values({ workspaceId: merged.id, contactId: phoneLead.id, source: "webhook", occurredAt: new Date("2026-09-01T10:00:00Z") });
    // The same person pays by email on 3 Sep with no device of their own: unattributed so far.
    [payer] = await db
      .insert(schema.contacts)
      .values({ workspaceId: merged.id, email: "priya.sharma@gmail.com", emailHash: hashEmail("priya.sharma@gmail.com"), phoneHash: hashPhone("+919876543210"), name: "Priya S", firstSeenAt: new Date("2026-09-03T08:00:00Z"), lifecycle: "customer", externalIds: { stripe: "cus_1" } })
      .returning();
    await db.insert(schema.revenueEvents).values({ workspaceId: merged.id, contactId: payer.id, source: "stripe", externalId: "pi_1", type: "payment", amountMinor: 12_000, currency: "USD", occurredAt: new Date("2026-09-03T08:00:00Z") });
    // Noise: a gmail variant of someone else, and a common-name pair where both have emails (not suggested).
    await db.insert(schema.contacts).values([
      { workspaceId: merged.id, email: "o.kay+promo@gmail.com", emailHash: hashEmail("o.kay+promo@gmail.com"), firstSeenAt: NOW },
      { workspaceId: merged.id, email: "okay@googlemail.com", emailHash: hashEmail("okay@googlemail.com"), firstSeenAt: NOW },
      { workspaceId: merged.id, email: "sam1@x.test", emailHash: hashEmail("sam1@x.test"), name: "Sam Lee", firstSeenAt: NOW },
      { workspaceId: merged.id, email: "sam2@y.test", emailHash: hashEmail("sam2@y.test"), name: "sam  lee", firstSeenAt: NOW },
    ]);
    await recomputeAttribution(db, merged.id);
  });

  const revenueCredits = async () =>
    rows<{ platform: string | null; revenue: string }>(
      await db.execute(sql`select platform, sum(revenue_minor) revenue from attribution_credits
        where workspace_id = ${merged.id} and model = 'last_touch' and conversion_type = 'revenue' group by platform`),
    ).map((r) => ({ platform: r.platform, revenue: Number(r.revenue) }));

  it("finds pairs by phone and by email variants, strongest first", async () => {
    const pairs = await findDuplicates(db, merged);
    expect(pairs).toHaveLength(2);
    const priya = pairs.find((p) => p.reasons.includes("same_phone"))!;
    expect(new Set([priya.a.id, priya.b.id])).toEqual(new Set([phoneLead.id, payer.id]));
    expect(priya.strength).toBe("strong");
    expect(priya.suggestedKeepId).toBe(payer.id); // has the email and the payment
    const payerSide = priya.a.id === payer.id ? priya.a : priya.b;
    expect(payerSide).toMatchObject({ payments: 1, revenueMinor: 12_000, lifecycle: "customer" });
    const leadSide = priya.a.id === phoneLead.id ? priya.a : priya.b;
    expect(leadSide).toMatchObject({ devices: 1, leads: 1, email: null, hasPhone: true });
    expect(pairs.some((p) => p.reasons.includes("same_email"))).toBe(true);
    expect(await findDuplicates(db, other)).toEqual([]);
  });

  it("suggests keeping the contact with an email, then more history", () => {
    const base = { id: "a", email: null, hasPhone: true, name: null, lifecycle: "lead" as const, firstSeenAt: "2026-01-01T00:00:00Z", lastActivityAt: null, devices: 0, leads: 0, payments: 0, revenueMinor: 0, otherCurrencies: false };
    expect(suggestKeep(base, { ...base, id: "b", email: "x@y.test" })).toBe("b");
    expect(suggestKeep({ ...base, payments: 2 }, { ...base, id: "b", leads: 5 })).toBe("a");
    expect(suggestKeep({ ...base, firstSeenAt: "2026-02-01T00:00:00Z" }, { ...base, id: "b" })).toBe("b");
  });

  it("forgets a pair marked as different people", async () => {
    const gmail = (await findDuplicates(db, merged)).find((p) => p.reasons.includes("same_email"))!;
    expect(await dismissDuplicate(db, merged, gmail.b.id, gmail.a.id)).toBe(true);
    expect(await dismissDuplicate(db, merged, gmail.b.id, gmail.a.id)).toBe(true); // idempotent
    expect(await dismissDuplicate(db, ws, gmail.a.id, gmail.b.id)).toBe(false); // wrong workspace
    expect((await findDuplicates(db, merged)).map((p) => p.reasons)).toEqual([["same_phone"]]);
  });

  it("merges: re-points the journey and changes attribution as expected", async () => {
    expect(await revenueCredits()).toEqual([{ platform: null, revenue: 12_000 }]);
    const result = await mergeContacts(db, merged, payer.id, phoneLead.id);
    expect(result.moved).toMatchObject({ visitors: 1, leads: 1 });
    expect(result.emailAdded).toBe(false);

    const [v] = await db.select().from(schema.visitors).where(eq(schema.visitors.id, visitorId));
    expect(v.contactId).toBe(payer.id);
    const leads = await db.select().from(schema.leads).where(eq(schema.leads.workspaceId, merged.id));
    expect(leads.map((l) => l.contactId)).toEqual([payer.id]);
    expect(await db.select().from(schema.contacts).where(eq(schema.contacts.id, phoneLead.id))).toHaveLength(0);
    const [kept] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, payer.id));
    expect(kept).toMatchObject({ name: "Priya S", email: "priya.sharma@gmail.com", lifecycle: "customer", firstSeenAt: new Date("2026-09-01T10:00:00Z"), externalIds: { stripe: "cus_1" } });

    // ADLEDGER_SYNC_JOBS=1 runs the recompute inline: the payment now belongs to the Meta click.
    expect(await revenueCredits()).toEqual([{ platform: "meta", revenue: 12_000 }]);
    const [lead] = rows<{ contact_id: string; platform: string }>(
      await db.execute(sql`select contact_id, platform from attribution_credits where workspace_id = ${merged.id} and model = 'first_touch' and conversion_type = 'customer'`),
    );
    expect(lead).toEqual({ contact_id: payer.id, platform: "meta" });
    expect(await findDuplicates(db, merged)).toEqual([]);
  });

  it("moves the email onto a kept contact that has none, and refuses cross-workspace merges", async () => {
    const a = await contact(null, "+1 646 555 0142", "Kim", merged);
    const b = await contact("kim@acme.test", "+1 646 555 0142", null, merged);
    const x = await contact("kim@acme.test", null, null, other);
    await expect(mergeContacts(db, merged, a.id, x.id)).rejects.toThrow(/no longer exists/);
    await expect(mergeContacts(db, merged, a.id, a.id)).rejects.toThrow(/two different/);
    const r = await mergeContacts(db, merged, a.id, b.id);
    expect(r.emailAdded).toBe(true);
    const [kept] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, a.id));
    expect(kept).toMatchObject({ email: "kim@acme.test", emailHash: hashEmail("kim@acme.test"), name: "Kim" });
    expect(await db.select().from(schema.contacts).where(eq(schema.contacts.id, x.id))).toHaveLength(1);
  });

  it("covers tables and columns added later: unique collisions are dropped, blank columns filled", async () => {
    // Stand-ins for what other features add (contact tags with a unique key, an owner column).
    await db.execute(sql`create table merge_probe_tags (
      id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
      contact_id uuid not null references contacts(id) on delete cascade, tag text not null, unique (contact_id, tag))`);
    await db.execute(sql`alter table contacts add column owner_probe text`);
    const k = await contact("lee@acme.test", null, "Lee", merged);
    const m = await contact(null, "+1 303 555 0100", "Lee", merged);
    await db.execute(sql`update contacts set owner_probe = 'ravi' where id = ${m.id}`);
    for (const [id, tag] of [[k.id, "vip"], [m.id, "vip"], [m.id, "wholesale"]]) {
      await db.execute(sql`insert into merge_probe_tags (workspace_id, contact_id, tag) values (${merged.id}, ${id}, ${tag})`);
    }
    const r = await mergeContacts(db, merged, k.id, m.id);
    expect(r.moved.merge_probe_tags).toBe(1);
    const tags = rows<{ tag: string }>(await db.execute(sql`select tag from merge_probe_tags where contact_id = ${k.id} order by tag`)).map((t) => t.tag);
    expect(tags).toEqual(["vip", "wholesale"]);
    expect(rows<{ n: string }>(await db.execute(sql`select count(*) n from merge_probe_tags`)).map((x) => Number(x.n))[0]).toBe(tags.length);
    expect(rows<{ owner_probe: string }>(await db.execute(sql`select owner_probe from contacts where id = ${k.id}`))[0].owner_probe).toBe("ravi");
    await db.execute(sql`drop table merge_probe_tags`);
    await db.execute(sql`alter table contacts drop column owner_probe`);
  });
});

describe("merge actions", () => {
  it("need workspace.data to merge and workspace.settings to dismiss", async () => {
    const a = await contact(null, "+1 555 010 9999", "Ivy");
    const b = await contact("ivy@acme.test", "+1 555 010 9999", "Ivy");
    session.token = await member("analyst");
    expect(await mergeContactsAction(b.id, a.id)).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    expect(await dismissDuplicateAction(a.id, b.id)).toMatchObject({ ok: false });
    session.token = await member("admin");
    expect(await mergeContactsAction("bad", a.id)).toMatchObject({ ok: false });
    expect(await mergeContactsAction(b.id, a.id)).toMatchObject({ ok: true });
    expect(await mergeContactsAction(b.id, a.id)).toMatchObject({ ok: false, message: expect.stringMatching(/no longer exists/) });
    const trail = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "contact.merged"));
    expect(trail).toHaveLength(1);
    expect(trail[0].target).toBe(b.id);
    session.token = undefined;
  });
});
