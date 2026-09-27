import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

// The Performance peek loads through a read-only server action: any member who can see reports may
// call it, it validates its input, and it never reaches into another workspace.

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let db: DB;
let ws: Workspace;
let orgId: string;
let campaignId: string;
let otherCampaignId: string;

async function member(role: Role, w: Workspace) {
  const [user] = await db.insert(schema.users).values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: w.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

const row = (key: string, spendMinor: number) => ({
  platform: "meta" as const,
  account: { externalId: `acc-${key}`, name: "Account", currency: "USD", timezone: null },
  campaign: { externalId: `c-${key}`, name: `Campaign ${key}`, status: "ACTIVE", objective: null },
  adGroup: { externalId: `g-${key}`, name: `Group ${key}`, status: null },
  ad: { externalId: `a-${key}`, name: `Ad ${key}`, status: null },
  date: "2026-07-01",
  spendMinor,
  impressions: 1000,
  clicks: 10,
  conversions: "3",
});

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  await upsertAdRows(db, ws.id, [row("mine", 10_000)]);
  [{ id: campaignId }] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.workspaceId, ws.id));
  const [w2] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  await upsertAdRows(db, w2.id, [row("theirs", 99_000)]);
  [{ id: otherCampaignId }] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.workspaceId, w2.id));
}, 120_000);

const input = (id: string, extra: Record<string, unknown> = {}) => ({ level: "campaign", id, start: "2026-07-01", end: "2026-07-31", model: "last_touch", ...extra });

describe("loadPeekAction", () => {
  it("lets a viewer (and a client) peek", async () => {
    const { loadPeekAction } = await import("@/app/(app)/performance/actions");
    for (const role of ["viewer", "client"] as const) {
      session.token = await member(role, ws);
      const res = await loadPeekAction(input(campaignId, { comparison: { start: "2026-06-01", end: "2026-06-30" } }));
      expect(res.ok).toBe(true);
      expect(res.peek?.row).toMatchObject({ name: "Campaign mine", spendMinor: 10_000, platformConversions: 3 });
      expect(res.peek?.trend).toHaveLength(31);
    }
  });

  it("refuses without a session and validates every field", async () => {
    const { loadPeekAction } = await import("@/app/(app)/performance/actions");
    session.token = undefined;
    expect((await loadPeekAction(input(campaignId))).ok).toBe(false);
    session.token = await member("analyst", ws);
    expect((await loadPeekAction(input(campaignId, { level: "account" }))).ok).toBe(false);
    expect((await loadPeekAction(input(campaignId, { model: "u_shaped" }))).ok).toBe(false);
    expect((await loadPeekAction(input(campaignId, { start: "2026-02-30" }))).ok).toBe(false);
    expect((await loadPeekAction(input(campaignId, { start: "2026-08-01" }))).ok).toBe(false);
    expect((await loadPeekAction(input(campaignId, { comparison: { start: "x", end: "y" } }))).ok).toBe(false);
    expect((await loadPeekAction(input(campaignId, { start: "2020-01-01" }))).ok).toBe(false);
  });

  it("never returns another workspace's campaign", async () => {
    const { loadPeekAction } = await import("@/app/(app)/performance/actions");
    session.token = await member("owner", ws);
    const res = await loadPeekAction(input(otherCampaignId));
    expect(res).toMatchObject({ ok: true, peek: null });
  });
});
