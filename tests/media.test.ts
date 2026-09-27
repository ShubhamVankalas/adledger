import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { removeOrganizationLogoAction, setAvatarAction, setOrganizationLogoAction } from "@/app/actions/media";
import { GET as media } from "@/app/api/media/[kind]/[id]/route";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { MAX_STORED_BYTES, mediaUrl, sniffImageType, validateImageUpload } from "@/lib/media";
import { roleCan } from "@/lib/permissions";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

const ctx = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.jar.set(name, value),
    delete: (name: string) => void ctx.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 26, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const file = (bytes: Uint8Array, type: string, name = "image") => new File([bytes as BlobPart], name, { type });
const formWith = (f: File) => {
  const form = new FormData();
  form.set("file", f);
  return form;
};

describe("image upload validation", () => {
  it("recognises PNG, JPEG and WebP by their magic bytes only", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("accepts a real PNG", async () => {
    const r = await validateImageUpload(file(PNG, "image/png"));
    expect(r).toMatchObject({ ok: true, type: "image/png" });
  });

  it("rejects SVG, even when it claims to be a PNG", async () => {
    expect(await validateImageUpload(file(SVG, "image/svg+xml"))).toMatchObject({ ok: false });
    expect(await validateImageUpload(file(SVG, "image/png"))).toMatchObject({ ok: false });
  });

  it("rejects bytes that don't match the declared type", async () => {
    expect(await validateImageUpload(file(JPEG, "image/png"))).toMatchObject({ ok: false });
    expect(await validateImageUpload(file(new TextEncoder().encode("hello"), "image/webp"))).toMatchObject({ ok: false });
  });

  it("rejects oversized, empty and missing files", async () => {
    const big = new Uint8Array(MAX_STORED_BYTES + 1);
    big.set(PNG);
    expect(await validateImageUpload(file(big, "image/png"))).toMatchObject({ ok: false, message: expect.stringMatching(/too large/) });
    expect(await validateImageUpload(file(new Uint8Array(), "image/png"))).toMatchObject({ ok: false });
    expect(await validateImageUpload(null)).toMatchObject({ ok: false });
    expect(await validateImageUpload("not a file")).toMatchObject({ ok: false });
  });

  it("builds cache-busting URLs only when an image exists", () => {
    expect(mediaUrl("user", "u1", null)).toBeNull();
    const a = mediaUrl("org", "o1", new Date("2026-01-01T00:00:00Z"));
    const b = mediaUrl("org", "o1", new Date("2026-01-02T00:00:00Z"));
    expect(a).toMatch(/^\/api\/media\/org\/o1\?v=/);
    expect(a).not.toBe(b);
  });
});

describe("avatars and logos", () => {
  let db: DB;
  let ws: Workspace;
  const users: Partial<Record<Role | "outsider", { id: string }>> = {};
  const tokens: Partial<Record<Role | "outsider", string>> = {};

  async function member(role: Role, email: string, orgId: string, workspaceId: string, key: Role | "outsider" = role) {
    const [u] = await db.insert(schema.users).values({ email, passwordHash: "x" }).returning();
    await db.insert(schema.memberships).values({ organizationId: orgId, userId: u.id, role });
    const token = randomToken(32);
    await db.insert(schema.sessions).values({ userId: u.id, workspaceId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
    users[key] = u;
    tokens[key] = token;
  }
  const signInAs = (who: Role | "outsider") => ctx.jar.set(SESSION_COOKIE, tokens[who]!);
  const get = (kind: string, id: string, who: Role | "outsider" | null, v = true) =>
    media(new Request(`http://localhost/api/media/${kind}/${id}${v ? "?v=1" : ""}`, { headers: who ? { cookie: `${SESSION_COOKIE}=${tokens[who]}` } : {} }), {
      params: Promise.resolve({ kind, id }),
    });

  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    await member("owner", "owner@media.test", ws.organizationId, ws.id);
    await member("admin", "admin@media.test", ws.organizationId, ws.id);
    await member("viewer", "viewer@media.test", ws.organizationId, ws.id);
    const [otherOrg] = await db.insert(schema.organizations).values({ name: "Other", slug: `other-${randomToken(4).toLowerCase()}` }).returning();
    const [otherWs] = await db.insert(schema.workspaces).values({ organizationId: otherOrg.id, name: "Other", slug: `other-ws-${randomToken(4).toLowerCase()}` }).returning();
    await member("owner", "outsider@media.test", otherOrg.id, otherWs.id, "outsider");
  });

  it("only owners and admins manage the organization logo", () => {
    expect(roleCan("owner", "org.branding")).toBe(true);
    expect(roleCan("admin", "org.branding")).toBe(true);
    expect(roleCan("analyst", "org.branding")).toBe(false);
    expect(roleCan("client", "org.branding")).toBe(false);
  });

  it("a viewer cannot set or remove the organization logo", async () => {
    signInAs("viewer");
    expect(await setOrganizationLogoAction(formWith(file(PNG, "image/png")))).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    expect(await removeOrganizationLogoAction()).toMatchObject({ ok: false });
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, ws.organizationId));
    expect(org.logo).toBeNull();
  });

  it("an admin can set the logo; members see it, other organizations don't", async () => {
    signInAs("admin");
    expect(await setOrganizationLogoAction(formWith(file(SVG, "image/svg+xml")))).toMatchObject({ ok: false });
    expect(await setOrganizationLogoAction(formWith(file(PNG, "image/png")))).toMatchObject({ ok: true });
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "organization.logo_updated"));
    expect(log?.userId).toBe(users.admin!.id);

    const res = await get("org", ws.organizationId, "viewer");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toMatch(/private.*max-age=31536000/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    expect((await get("org", ws.organizationId, "outsider")).status).toBe(404);
    expect((await get("org", ws.organizationId, null)).status).toBe(401);
    expect((await get("org", "not-a-uuid", "viewer")).status).toBe(404);

    // The session exposes a versioned URL for the sidebar.
    const me = await getSessionUser();
    expect(me?.organization.logoUrl).toMatch(new RegExp(`^/api/media/org/${ws.organizationId}\\?v=`));
    expect(me?.organization).not.toHaveProperty("logo");
  });

  it("any member can set their own profile picture, visible to their organization only", async () => {
    signInAs("viewer");
    expect(await setAvatarAction(formWith(file(WEBP, "image/webp")))).toMatchObject({ ok: true });
    const me = await getSessionUser();
    expect(me?.avatarUrl).toMatch(new RegExp(`^/api/media/user/${users.viewer!.id}\\?v=`));

    const res = await get("user", users.viewer!.id, "owner", false);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect((await get("user", users.viewer!.id, "viewer")).status).toBe(200);
    expect((await get("user", users.viewer!.id, "outsider")).status).toBe(404);
    // Someone without a picture is a 404 too.
    expect((await get("user", users.owner!.id, "viewer")).status).toBe(404);
  });
});
