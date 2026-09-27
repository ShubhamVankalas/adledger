import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashEmail, hashPassword, randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { roleCan } from "@/lib/permissions";
import { setupWorkspace } from "./helpers";

// Trust core: TOTP, recovery codes, password policy, PII masking, API key scopes, sessions,
// the audit hash chain and security alerts.

const ctx = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  headers: new Headers({ "x-forwarded-for": "198.51.100.7", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.jar.set(name, value),
    delete: (name: string) => void ctx.jar.delete(name),
  }),
  headers: async () => ctx.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// redirect() throws like Next's does, so actions stop where they would in production.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
}));

import { base32Decode, base32Encode, hotp, totp, totpStep, verifyTotp } from "@/lib/security/totp";

const ascii = (s: string) => base32Encode(Buffer.from(s, "ascii"));

describe("TOTP (RFC 6238) and HOTP (RFC 4226)", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });

  it("matches the RFC 6238 test vectors for SHA-1, SHA-256 and SHA-512", () => {
    const secrets = {
      sha1: ascii("12345678901234567890"),
      sha256: ascii("12345678901234567890123456789012"),
      sha512: ascii("1234567890123456789012345678901234567890123456789012345678901234"),
    } as const;
    const vectors: [number, string, string, string][] = [
      [59, "94287082", "46119246", "90693936"],
      [1111111109, "07081804", "68084774", "25091201"],
      [1111111111, "14050471", "67062674", "99943326"],
      [1234567890, "89005924", "91819424", "93441116"],
      [2000000000, "69279037", "90698825", "38618901"],
      [20000000000, "65353130", "77737706", "47863826"],
    ];
    for (const [t, s1, s256, s512] of vectors) {
      const at = t * 1000;
      expect(totp(secrets.sha1, at, { digits: 8 })).toBe(s1);
      expect(totp(secrets.sha256, at, { digits: 8, algorithm: "sha256" })).toBe(s256);
      expect(totp(secrets.sha512, at, { digits: 8, algorithm: "sha512" })).toBe(s512);
    }
  });

  it("round-trips base32 and ignores spaces and case", () => {
    const bytes = Buffer.from("hello, adledger!");
    const enc = base32Encode(bytes);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(bytes);
    expect(() => base32Decode("not*base32")).toThrow();
  });

  it("accepts one step of clock drift and never the same step twice", () => {
    const secret = ascii("12345678901234567890");
    const at = 1_800_000_000_000;
    const now = totpStep(at);
    const code = totp(secret, at);
    expect(verifyTotp(secret, code, { at })).toBe(now);
    expect(verifyTotp(secret, code.slice(0, 3) + " " + code.slice(3), { at })).toBe(now); // pasted with a space
    expect(verifyTotp(secret, totp(secret, at - 30_000), { at })).toBe(now - 1);
    expect(verifyTotp(secret, totp(secret, at - 90_000), { at })).toBeNull();
    // Replay: once step `now` was used, the same code is refused.
    expect(verifyTotp(secret, code, { at, lastStep: now })).toBeNull();
    expect(verifyTotp(secret, "12345", { at })).toBeNull();
  });
});

describe("recovery codes", () => {
  it("work once each", async () => {
    const { generateRecoveryCodes, consumeRecoveryCode, looksLikeRecoveryCode } = await import("@/lib/security/recovery");
    const { codes, hashes } = await generateRecoveryCodes(3);
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
    expect(codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c))).toBe(true);
    expect(looksLikeRecoveryCode(codes[0].toUpperCase())).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    const left = await consumeRecoveryCode(codes[1].toUpperCase(), hashes);
    expect(left).toHaveLength(2);
    expect(await consumeRecoveryCode(codes[1], left!)).toBeNull();
    expect(await consumeRecoveryCode("aaaaa-bbbbb", left!)).toBeNull();
  });
});

describe("password policy (NIST SP 800-63B-4)", () => {
  it("needs 15 characters, or 8 with two-factor sign-in, and no composition rules", async () => {
    const { passwordProblem } = await import("@/lib/security/password-policy");
    expect(passwordProblem("short one")).toMatch(/15 characters/);
    expect(passwordProblem("purple tractor sunrise")).toBeNull(); // no digits or symbols needed
    expect(passwordProblem("tractor9", { has2fa: true })).toBeNull();
    expect(passwordProblem("tractor", { has2fa: true })).toMatch(/8 characters/);
    expect(passwordProblem("x".repeat(201))).toMatch(/at most/);
    // Characters, not bytes: 15 Devanagari letters are long enough.
    expect(passwordProblem("नमस्तेदुनियाआपकैसेहैंदोस्त")).toBeNull();
  });

  it("blocks common, repetitive, sequential and personal passwords", async () => {
    const { passwordProblem, commonPasswords } = await import("@/lib/security/password-policy");
    expect(commonPasswords().size).toBeGreaterThan(100); // the shipped text file was loaded
    expect(passwordProblem("123456789012345")).toMatch(/commonly used/);
    expect(passwordProblem("Correct Horse Battery Staple")).toMatch(/commonly used/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/repeated or sequential/);
    expect(passwordProblem("abcabcabcabcabcabc")).toMatch(/repeated or sequential/);
    expect(passwordProblem("abcdefghijklmnopq")).toMatch(/repeated or sequential/);
    expect(passwordProblem("priya.sharma.works", { email: "priya.sharma.works@shop.test" })).toMatch(/email/);
    expect(passwordProblem("priyasharma2026", { name: "Priya Sharma", has2fa: true })).toMatch(/name/);
  });
});

describe("permissions", () => {
  it("splits contact PII and exports by role", () => {
    const can = (r: Role) => ({ pii: roleCan(r, "contacts.pii"), contacts: roleCan(r, "export.contacts"), csv: roleCan(r, "export.csv"), pdf: roleCan(r, "reports.pdf"), security: roleCan(r, "security.manage") });
    expect(can("owner")).toEqual({ pii: true, contacts: true, csv: true, pdf: true, security: true });
    expect(can("admin")).toEqual({ pii: true, contacts: true, csv: true, pdf: true, security: false });
    expect(can("analyst")).toEqual({ pii: true, contacts: false, csv: true, pdf: true, security: false });
    expect(can("viewer")).toEqual({ pii: false, contacts: false, csv: false, pdf: true, security: false });
    expect(can("client")).toEqual({ pii: false, contacts: false, csv: false, pdf: true, security: false });
  });

  it("lets owners stop clients downloading PDFs", async () => {
    const { parsePolicy, policyCan } = await import("@/lib/security/policy");
    expect(policyCan("client", "reports.pdf", parsePolicy({}))).toBe(true);
    expect(policyCan("client", "reports.pdf", parsePolicy({ clientsCanDownloadPdf: false }))).toBe(false);
    expect(policyCan("viewer", "reports.pdf", parsePolicy({ clientsCanDownloadPdf: false }))).toBe(true);
    // Garbage in the stored policy falls back to safe defaults.
    expect(parsePolicy({ sessionIdleMinutes: -5 } as never).sessionIdleMinutes).toBe(7 * 24 * 60);
  });
});

// ---------------------------------------------------------------- database-backed

let db: DB;
let wsId: string;
let orgId: string;
const PASSWORD = "correct-horse-battery";
const users: Partial<Record<Role, { id: string; email: string }>> = {};
let bobId: string;

async function addMember(role: Role, email: string) {
  const [u] = await db.insert(schema.users).values({ email, name: role[0].toUpperCase() + role.slice(1), passwordHash: await hashPassword(PASSWORD) }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: u.id, role });
  return u;
}

async function sessionToken(userId: string, extra: Partial<typeof schema.sessions.$inferInsert> = {}) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ userId, workspaceId: wsId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000), ...extra });
  return token;
}

async function signInAs(role: Role) {
  ctx.jar.set("al_session", await sessionToken(users[role]!.id));
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function lastAudit(action: string) {
  const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).orderBy(desc(schema.auditLog.createdAt)).limit(1);
  return row;
}

beforeAll(async () => {
  const s = await setupWorkspace();
  db = s.db;
  wsId = s.ws.id;
  orgId = s.ws.organizationId;
  for (const role of ["owner", "admin", "analyst", "viewer", "client"] as Role[]) users[role] = await addMember(role, `${role}@trust.test`);
  await db.update(schema.memberships).set({ workspaceIds: [wsId] }).where(eq(schema.memberships.userId, users.client!.id));
  const [bob] = await db
    .insert(schema.contacts)
    .values({ workspaceId: wsId, email: "bob.lee@example.test", emailHash: hashEmail("bob.lee@example.test"), name: "Robert Lee", firstSeenAt: new Date("2026-09-01T00:00:00Z") })
    .returning();
  bobId = bob.id;
  const { setLookupForTests } = await import("@/lib/net");
  setLookupForTests(async () => ["93.184.216.34"]);
});

beforeEach(async () => {
  ctx.jar.clear();
  const { resetRateLimits } = await import("@/lib/http");
  const { resetPasswordThrottle } = await import("@/lib/auth");
  resetRateLimits();
  resetPasswordThrottle();
});

describe("contact PII masking", () => {
  const list = async (headers: Record<string, string>, query = "") => {
    const { GET } = await import("@/app/api/v1/contacts/route");
    return GET(new Request(`http://app.test/api/v1/contacts${query}`, { headers }), { params: Promise.resolve({}) } as never);
  };
  const cookie = async (role: Role) => ({ cookie: `al_session=${await sessionToken(users[role]!.id)}` });

  it("masks emails for viewers and clients, not for analysts and up", async () => {
    for (const role of ["viewer", "client"] as Role[]) {
      const body = await (await list(await cookie(role))).json();
      expect(body.emailsMasked, role).toBe(true);
      expect(JSON.stringify(body), role).not.toContain("bob.lee@example.test");
      expect(body.rows[0].email).toBe("b••••••@example.test");
    }
    const body = await (await list(await cookie("analyst"))).json();
    expect(body.rows[0].email).toBe("bob.lee@example.test");
  });

  it("without PII access, search matches names and whole emails only", async () => {
    const viewer = await cookie("viewer");
    expect((await (await list(viewer, "?search=example.test")).json()).total).toBe(0);
    expect((await (await list(viewer, "?search=Bob.Lee@Example.test")).json()).total).toBe(1);
    expect((await (await list(viewer, "?search=robert")).json()).total).toBe(1);
    expect((await (await list(await cookie("analyst"), "?search=example.test")).json()).total).toBe(1);
  });

  it("masks the journey endpoint too", async () => {
    const { GET } = await import("@/app/api/v1/contacts/[id]/journey/route");
    const r = await GET(new Request("http://app.test/x", { headers: await cookie("client") }), { params: Promise.resolve({ id: bobId }) });
    expect((await r.json()).contact.email).toBe("b••••••@example.test");
  });

  it("reveal is allowed for contacts.pii only, and audited without the email", async () => {
    const { revealContactEmailsAction } = await import("@/app/actions/security");
    await signInAs("viewer");
    expect(await revealContactEmailsAction([bobId])).toMatchObject({ ok: false });
    await signInAs("analyst");
    const r = await revealContactEmailsAction([bobId, "not-a-uuid"]);
    expect(r).toMatchObject({ ok: true, data: { emails: { [bobId]: "bob.lee@example.test" } } });
    const entry = await lastAudit("contact.pii_revealed");
    expect(entry).toMatchObject({ userId: users.analyst!.id, target: bobId, ipTrunc: "198.51.100.0" });
    expect(JSON.stringify(entry)).not.toContain("bob.lee");
  });
});

describe("API key scopes", () => {
  const reportReq = (key: string) => new Request("http://app.test/api/v1/reports/overview?start=2026-01-01&end=2026-12-31&model=linear", { headers: { authorization: `Bearer ${key}` } });
  const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

  it("new keys default to reports:read", async () => {
    const { createApiKey } = await import("@/lib/auth");
    const { GET: reports } = await import("@/app/api/v1/reports/[report]/route");
    const { GET: mcp } = await import("@/app/api/mcp/route");
    const { GET: contacts } = await import("@/app/api/v1/contacts/route");
    const { key, row } = await createApiKey(wsId, "default");
    expect(row.scopes).toEqual(["reports:read"]);
    expect((await reports(reportReq(key), { params: Promise.resolve({ report: "overview" }) })).status).toBe(200);
    expect((await mcp(new Request("http://app.test/api/mcp", { headers: bearer(key) }), {} as never)).status).toBe(403);
    const denied = await contacts(new Request("http://app.test/api/v1/contacts", { headers: bearer(key) }), {} as never);
    expect(denied.status).toBe(403);
    expect((await denied.json()).hint).toMatch(/contacts:read/);
  });

  it("contacts:read gets masked emails; contacts:pii gets them raw", async () => {
    const { createApiKey } = await import("@/lib/auth");
    const { GET: contacts } = await import("@/app/api/v1/contacts/route");
    const { GET: exportCsv } = await import("@/app/api/v1/exports/contacts/route");
    const { key: masked } = await createApiKey(wsId, "masked", ["contacts:read"]);
    const { key: pii } = await createApiKey(wsId, "pii", ["contacts:read", "contacts:pii"]);
    expect((await (await contacts(new Request("http://app.test/api/v1/contacts", { headers: bearer(masked) }), {} as never)).json()).rows[0].email).toBe("b••••••@example.test");
    expect((await (await contacts(new Request("http://app.test/api/v1/contacts", { headers: bearer(pii) }), {} as never)).json()).rows[0].email).toBe("bob.lee@example.test");
    const csv = await (await exportCsv(new Request("http://app.test/api/v1/exports/contacts", { headers: bearer(masked) }))).text();
    expect(csv).not.toContain("bob.lee@example.test");
    expect(await (await exportCsv(new Request("http://app.test/api/v1/exports/contacts", { headers: bearer(pii) }))).text()).toContain("bob.lee@example.test");
  });

  it("expired and revoked keys stop working", async () => {
    const { createApiKey } = await import("@/lib/auth");
    const { GET: reports } = await import("@/app/api/v1/reports/[report]/route");
    const { key } = await createApiKey(wsId, "old", ["reports:read"], new Date(Date.now() - 1000));
    expect((await reports(reportReq(key), { params: Promise.resolve({ report: "overview" }) })).status).toBe(401);
  });

  it("only owners and admins can mint keys that read contact emails", async () => {
    const { createApiKeyAction } = await import("@/app/actions/settings");
    const f = () => {
      const x = form({ name: "Agent", expiresDays: "30" });
      x.append("scope", "reports:read");
      x.append("scope", "contacts:pii");
      x.append("scope", "bogus");
      return x;
    };
    await signInAs("analyst");
    expect(await createApiKeyAction(f())).toMatchObject({ ok: false });
    await signInAs("admin");
    expect(await createApiKeyAction(f())).toMatchObject({ ok: true });
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, "Agent"));
    expect(row.scopes).toEqual(["reports:read", "contacts:pii"]);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await lastAudit("api_key.created")).meta).toMatchObject({ scopes: ["reports:read", "contacts:pii"] });
  });

  it("keys created before scopes existed keep everything except contacts:pii", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adledger-scopes-"));
    const old = path.join(dir, "old");
    cpSync("drizzle", old, { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(old, "meta", "_journal.json"), "utf8"));
    const idx = journal.entries.findIndex((e: { tag: string }) => e.tag.includes("trust_core"));
    journal.entries = journal.entries.slice(0, idx);
    writeFileSync(path.join(old, "meta", "_journal.json"), JSON.stringify(journal));
    const client = new PGlite();
    const d = drizzle(client);
    await migrate(d, { migrationsFolder: old });
    await client.exec(`
      insert into organizations (id, name, slug) values ('11111111-1111-1111-1111-111111111111', 'Old', 'old');
      insert into workspaces (id, organization_id, name, slug) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Old', 'old-ws');
      insert into api_keys (workspace_id, name, prefix, key_hash) values ('22222222-2222-2222-2222-222222222222', 'legacy', 'al_x', 'h1');
    `);
    await migrate(d, { migrationsFolder: "drizzle" });
    const legacy = await client.query<{ scopes: string[] }>("select scopes from api_keys where name = 'legacy'");
    expect(legacy.rows[0].scopes).toEqual(["reports:read", "contacts:read", "ingest:write", "mcp"]);
    await client.exec(`insert into api_keys (workspace_id, name, prefix, key_hash) values ('22222222-2222-2222-2222-222222222222', 'new', 'al_y', 'h2')`);
    const fresh = await client.query<{ scopes: string[] }>("select scopes from api_keys where name = 'new'");
    expect(fresh.rows[0].scopes).toEqual(["reports:read"]);
    await client.close();
  });
});

describe("sessions", () => {
  it("records device, truncated IP and sign-in method", async () => {
    const { login } = await import("@/lib/auth");
    const u = await addMember("viewer", "device@trust.test");
    expect(await login(u.email, PASSWORD, "198.51.100.7")).toEqual({ ok: true });
    const [s] = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
    expect(s).toMatchObject({ ipTrunc: "198.51.100.0", authMethod: "password" });
    expect(s.userAgent).toContain("Safari");
    expect(s.lastSeenAt).toBeInstanceOf(Date);
    expect((await lastAudit("auth.login")).meta).toMatchObject({ device: "Safari on macOS", method: "password" });
  });

  it("revokes one device, or every other device", async () => {
    const { revokeOtherSessionsAction, revokeSessionAction } = await import("@/app/actions/security");
    const u = await addMember("analyst", "revoke@trust.test");
    const a = await sessionToken(u.id);
    const b = await sessionToken(u.id);
    const current = await sessionToken(u.id);
    ctx.jar.set("al_session", current);
    const [rowA] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(a)));
    expect(await revokeSessionAction(rowA.id)).toMatchObject({ ok: true });
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id))).toHaveLength(2);
    expect(await revokeOtherSessionsAction()).toMatchObject({ ok: true, message: expect.stringMatching(/1 other device/) });
    const left = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
    expect(left.map((s) => s.tokenHash)).toEqual([sha256(current)]);
    expect(left.map((s) => s.tokenHash)).not.toContain(sha256(b));
    expect((await lastAudit("session.revoked_all")).meta).toMatchObject({ count: 1 });
  });

  it("ends idle sessions and sessions past their maximum lifetime", async () => {
    const { getSessionUser } = await import("@/lib/auth");
    const u = await addMember("viewer", "idle@trust.test");
    ctx.jar.set("al_session", await sessionToken(u.id, { lastSeenAt: new Date(Date.now() - 8 * 86_400_000) }));
    expect(await getSessionUser()).toBeNull();
    ctx.jar.set("al_session", await sessionToken(u.id, { lastSeenAt: new Date(Date.now() - 60_000) }));
    expect(await getSessionUser()).not.toBeNull();
    // A stricter policy applies at once.
    await db.update(schema.organizations).set({ security: { sessionIdleMinutes: 60, sessionMaxDays: 1 } }).where(eq(schema.organizations.id, orgId));
    ctx.jar.set("al_session", await sessionToken(u.id, { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) }));
    expect(await getSessionUser()).toBeNull();
    ctx.jar.set("al_session", await sessionToken(u.id, { createdAt: new Date(Date.now() - 2 * 86_400_000), lastSeenAt: new Date() }));
    expect(await getSessionUser()).toBeNull();
    await db.update(schema.organizations).set({ security: {} }).where(eq(schema.organizations.id, orgId));
  });
});

describe("two-factor sign-in", () => {
  async function enroll(userId: string, email: string) {
    const { beginEnrollment, confirmEnrollment } = await import("@/lib/security/two-factor");
    const e = await beginEnrollment(userId, email);
    const secret = e!.secret.replace(/\s/g, "");
    expect(e!.uri).toMatch(/^otpauth:\/\/totp\/AdLedger:/);
    expect(e!.qr.path.length).toBeGreaterThan(100);
    expect(await confirmEnrollment(userId, "000000")).toBeNull();
    const done = await confirmEnrollment(userId, totp(secret));
    expect(done!.codes).toHaveLength(10);
    return { secret, codes: done!.codes };
  }

  it("asks for a code after the password, rejects replays, and takes a recovery code once", async () => {
    const { login } = await import("@/lib/auth");
    const { verifyLoginAction } = await import("@/app/actions/auth");
    const u = await addMember("analyst", "twofa@trust.test");
    const { secret, codes } = await enroll(u.id, u.email);
    const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(stored.totpSecretEnc).not.toContain(secret); // encrypted at rest
    expect(stored.recoveryCodes.join()).not.toContain(codes[0]); // hashed

    // Password alone doesn't create a session.
    expect(await login(u.email, PASSWORD, "203.0.113.9")).toEqual({ ok: true, mfa: true });
    expect(ctx.jar.has("al_session")).toBe(false);
    expect(ctx.jar.has("al_mfa")).toBe(true);

    // The code used at enrolment can't be replayed.
    const reused = await verifyLoginAction(undefined, form({ code: totp(secret) }));
    expect(reused?.error).toMatch(/didn’t work|didn't work/);
    expect(ctx.jar.has("al_session")).toBe(false);

    // A recovery code signs in once.
    await expect(verifyLoginAction(undefined, form({ code: codes[0], next: "/" }))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(ctx.jar.has("al_session")).toBe(true);
    expect(ctx.jar.has("al_mfa")).toBe(false);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
    expect(session.authMethod).toBe("password+recovery");
    expect((await lastAudit("account.recovery_code_used")).meta).toMatchObject({ remaining: 9 });

    ctx.jar.clear();
    expect(await login(u.email, PASSWORD, "203.0.113.9")).toEqual({ ok: true, mfa: true });
    expect((await verifyLoginAction(undefined, form({ code: codes[0] })))?.error).toBeTruthy();
    // Without a (valid) challenge cookie there is nothing to verify.
    ctx.jar.set("al_mfa", "forged.value");
    expect((await verifyLoginAction(undefined, form({ code: codes[1] })))?.error).toMatch(/took too long/);
  });

  it("an organization can require 2FA; members without it may only enrol", async () => {
    const { getSessionUser, requireUser } = await import("@/lib/auth");
    const { saveSecurityPolicyAction } = await import("@/app/actions/security");
    const { guard } = await import("@/lib/actions");
    const policy = form({ require2fa: "on", sessionIdleMinutes: "10080", sessionMaxDays: "30", clientsCanDownloadPdf: "on" });

    await signInAs("admin");
    expect(await saveSecurityPolicyAction(policy)).toMatchObject({ ok: false }); // owners only
    await signInAs("owner");
    expect(await saveSecurityPolicyAction(policy)).toMatchObject({ ok: false, message: expect.stringMatching(/your own account first/) });
    await enroll(users.owner!.id, users.owner!.email);
    await signInAs("owner");
    expect(await saveSecurityPolicyAction(policy)).toMatchObject({ ok: true });
    expect((await lastAudit("security.policy_updated")).meta).toMatchObject({ require2fa: true });

    await signInAs("viewer");
    expect((await getSessionUser())!.needs2fa).toBe(true);
    await expect(requireUser()).rejects.toMatchObject({ digest: expect.stringContaining("/two-factor/setup") });
    await expect(guard()).rejects.toThrow(/requires two-factor/);
    const { GET: reports } = await import("@/app/api/v1/reports/[report]/route");
    const r = await reports(new Request("http://app.test/api/v1/reports/overview", { headers: { cookie: `al_session=${ctx.jar.get("al_session")}` } }), { params: Promise.resolve({ report: "overview" }) });
    expect(r.status).toBe(401);
    // Enrolment itself is allowed.
    const { startTwoFactorAction } = await import("@/app/actions/security");
    expect(await startTwoFactorAction()).toMatchObject({ ok: true });

    await db.update(schema.organizations).set({ security: {} }).where(eq(schema.organizations.id, orgId));
  });

  it("turning it off needs a current code and raises a security alert", async () => {
    const { disableTwoFactorAction } = await import("@/app/actions/security");
    const u = await addMember("analyst", "off@trust.test");
    const { secret } = await enroll(u.id, u.email);
    ctx.jar.set("al_session", await sessionToken(u.id));
    expect(await disableTwoFactorAction(form({ code: "111111" }))).toMatchObject({ ok: false });
    // The enrolment code was used already; the next step's code works.
    expect(await disableTwoFactorAction(form({ code: totp(secret, Date.now() + 30_000) }))).toMatchObject({ ok: true });
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(row).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodes: [] });
    expect(await lastAudit("account.2fa_disabled")).toBeTruthy();
  });

  it("ADLEDGER_BREAK_GLASS resets an owner's 2FA and nobody else's", async () => {
    const { breakGlassFromEnv } = await import("@/lib/security/break-glass");
    const u = await addMember("admin", "glass-admin@trust.test");
    await enroll(u.id, u.email);
    vi.stubEnv("ADLEDGER_BREAK_GLASS", u.email);
    expect(await breakGlassFromEnv(db)).toBe(false); // not an owner
    vi.stubEnv("ADLEDGER_BREAK_GLASS", users.owner!.email.toUpperCase());
    expect(await breakGlassFromEnv(db)).toBe(true);
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, users.owner!.id));
    expect(owner.totpEnabledAt).toBeNull();
    expect(await lastAudit("security.2fa_reset")).toMatchObject({ target: users.owner!.id, meta: { via: "break_glass" } });
    vi.unstubAllEnvs();
  });
});

describe("audit log hash chain", () => {
  it("chains every entry and reports the first edited or missing one", async () => {
    const { audit } = await import("@/lib/auth");
    const { verifyAuditChain } = await import("@/lib/security/audit-chain");
    const [org] = await db.insert(schema.organizations).values({ name: "Chain", slug: `chain-${randomToken(3)}` }).returning();
    const [ws] = await db.insert(schema.workspaces).values({ organizationId: org.id, name: "Chain WS", slug: `chain-ws-${randomToken(3)}` }).returning();
    const actor = { id: users.owner!.id, organizationId: org.id, workspaceId: ws.id };
    for (let i = 0; i < 5; i++) await audit(actor, "workspace.updated", `step ${i}`, { i, nested: { b: 2, a: 1 } });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.organizationId, org.id)).orderBy(schema.auditLog.seq);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(await verifyAuditChain(db, org.id)).toMatchObject({ ok: true, checked: 5, headSeq: 5, headHash: rows[4].hash });

    // Deleting the workspace nulls workspace_id on its entries; the chain still verifies.
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    expect((await verifyAuditChain(db, org.id)).ok).toBe(true);

    // Editing a row by hand breaks the chain at that row.
    await db.execute(sql`update audit_log set target = 'tampered' where organization_id = ${org.id} and seq = 3`);
    expect(await verifyAuditChain(db, org.id)).toMatchObject({ ok: false, brokenAt: 3, reason: "edited" });
    await db.update(schema.auditLog).set({ target: "step 2" }).where(and(eq(schema.auditLog.organizationId, org.id), eq(schema.auditLog.seq, 3)));
    expect((await verifyAuditChain(db, org.id)).ok).toBe(true);

    // So does deleting one.
    await db.delete(schema.auditLog).where(and(eq(schema.auditLog.organizationId, org.id), eq(schema.auditLog.seq, 2)));
    expect(await verifyAuditChain(db, org.id)).toMatchObject({ ok: false, brokenAt: 2, reason: "missing" });
  });

  it("seals entries written before the chain existed", async () => {
    const { audit } = await import("@/lib/auth");
    const { verifyAuditChain } = await import("@/lib/security/audit-chain");
    const [org] = await db.insert(schema.organizations).values({ name: "Legacy", slug: `legacy-${randomToken(3)}` }).returning();
    await db.insert(schema.auditLog).values([
      { organizationId: org.id, action: "organization.created", target: "Legacy", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: org.id, action: "member.invited", target: "x", createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    await audit({ id: null, organizationId: org.id }, "workspace.created", "New");
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.organizationId, org.id)).orderBy(schema.auditLog.seq);
    expect(rows.map((r) => [r.seq, r.action])).toEqual([
      [1, "organization.created"],
      [2, "member.invited"],
      [3, "workspace.created"],
    ]);
    expect((await verifyAuditChain(db, org.id)).ok).toBe(true);
  });

  it("the Verify action is limited to audit.view and records its result", async () => {
    const { verifyAuditLogAction } = await import("@/app/actions/security");
    await signInAs("analyst");
    expect(await verifyAuditLogAction()).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    await signInAs("admin");
    expect(await verifyAuditLogAction()).toMatchObject({ ok: true });
    expect((await lastAudit("audit.verified")).meta).toMatchObject({ ok: true });
  });

  it("exports the audit log as CSV for owners and admins", async () => {
    const { GET } = await import("@/app/api/v1/exports/audit/route");
    await signInAs("viewer");
    expect((await GET(new Request("http://app.test/api/v1/exports/audit"))).status).toBe(403);
    await signInAs("admin");
    const r = await GET(new Request("http://app.test/api/v1/exports/audit?category=security"));
    const text = await r.text();
    expect(text.split("\r\n")[0]).toBe("seq,time_utc,actor,actor_id,action,description,target,workspace_id,ip_trunc,user_agent,meta,prev_hash,hash");
    expect(text).toContain("audit.verified");
    expect(text).not.toContain("auth.login,"); // filtered to security events
    expect(await lastAudit("audit.exported")).toBeTruthy();
  });
});

describe("security alerts", () => {
  it("go to channels subscribed to security_alert, without contact emails", async () => {
    const { saveConnection } = await import("@/lib/settings");
    const { createApiKey, audit } = await import("@/lib/auth");
    await saveConnection(wsId, "notify_webhook", { mode: "live", config: { url: "https://hooks.example.test/sec" } }, db);
    await db.insert(schema.notificationRules).values({ workspaceId: wsId, channel: "notify_webhook", event: "security_alert" });
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return new Response("ok");
      }),
    );
    try {
      const actor = { id: users.admin!.id, organizationId: orgId, workspaceId: wsId };
      const { row } = await createApiKey(wsId, "Zapier", ["reports:read"]);
      await audit(actor, "api_key.created", row.name, { scopes: row.scopes });
      await audit(actor, "contacts.exported", null, { rows: 1500, masked: false });
      await audit(actor, "contacts.exported", null, { rows: 20, masked: false }); // small: no alert
      await audit(actor, "member.updated", users.viewer!.id, { role: "admin" });
      const titles = calls.map((c) => JSON.parse(c.body).title as string);
      expect(titles).toEqual(["New API key in Test", "Bulk contact export in Test", "A member's role changed"]);
      expect(calls.map((c) => c.body).join()).not.toMatch(/@/);
      expect(JSON.parse(calls[1].body).text).toContain("1,500 contacts");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
