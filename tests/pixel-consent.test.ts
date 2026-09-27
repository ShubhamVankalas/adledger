import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type DB } from "@/lib/db";
import type { Workspace } from "@/lib/settings";
import { collectSchema, processCollect, type CollectPayload } from "@/lib/tracking/collect";
import { hashEmail } from "@/lib/crypto";
import { setupWorkspace } from "./helpers";

// The pixel runs in a bare sandbox that records every cookie write, storage write and beacon, so
// "sends nothing / stores nothing before consent" is checked on the real bundle.

type Beacon = { site: string; vid: string | null; consent?: string; gpc?: boolean; fbp?: string | null; events: { t: string; name?: string }[] };

const bundle = buildSync({ entryPoints: ["pixel/al.ts"], bundle: true, write: false, format: "iife", target: ["es2018"] }).outputFiles[0].text;

function loadPixel(opts: { consent?: string; gpc?: boolean; cookies?: Record<string, string> } = {}) {
  const beacons: Beacon[] = [];
  const cookieWrites: string[] = [];
  const storageWrites: string[] = [];
  const jar = new Map<string, string>(Object.entries(opts.cookies ?? {}));
  const timers: (() => void)[] = [];
  const attrs: Record<string, string> = { "data-site": "pk_consent00001" };
  if (opts.consent) attrs["data-consent"] = opts.consent;
  const document = {
    currentScript: { src: "https://adledger.test/p/al.js", getAttribute: (k: string) => attrs[k] ?? null },
    querySelector: () => null,
    referrer: "https://www.google.com/",
    visibilityState: "visible",
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(s: string) {
      cookieWrites.push(s);
      const [kv, ...rest] = s.split(";");
      const [k, v] = kv.split("=");
      if (rest.some((a) => a.trim() === "Max-Age=0")) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    },
    addEventListener() {},
  };
  class FakeBlob {
    constructor(public parts: string[]) {}
  }
  const sandbox: Record<string, unknown> = {
    document,
    location: { href: "https://shop.test/?gclid=Cj0-test", protocol: "https:", hostname: "shop.test" },
    history: { pushState() {}, replaceState() {} },
    navigator: {
      ...(opts.gpc ? { globalPrivacyControl: true } : {}),
      sendBeacon: (_u: string, b: FakeBlob) => {
        beacons.push(JSON.parse(b.parts.join("")));
        return true;
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: (k: string) => storageWrites.push(`set:${k}`),
      removeItem: (k: string) => storageWrites.push(`remove:${k}`),
    },
    addEventListener() {},
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout() {},
    URL,
    Blob: FakeBlob,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(bundle, sandbox);
  const tick = () => timers.splice(0).forEach((fn) => fn());
  const api = sandbox.adledger as { consent(v: boolean): void; lead(t: Record<string, string>, f?: string): void; track(n: string): void; getVisitorId(): string | null };
  return { beacons, cookieWrites, storageWrites, jar, tick, api };
}

describe("pixel consent modes", () => {
  it("stays under the 5 KB gzipped budget", () => {
    const min = buildSync({ entryPoints: ["pixel/al.ts"], bundle: true, write: false, minify: true, format: "iife", target: ["es2018"], legalComments: "none" });
    expect(gzipSync(min.outputFiles[0].contents).length).toBeLessThan(5 * 1024);
  });

  it("optout (default): tracks at once with a 13-month first-party cookie", () => {
    const px = loadPixel();
    px.tick();
    expect(px.beacons).toHaveLength(1);
    expect(px.beacons[0]).toMatchObject({ site: "pk_consent00001", consent: "unknown", gpc: false, events: [{ t: "page_view" }] });
    const vidCookie = px.cookieWrites.find((c) => c.startsWith("_al_vid="))!;
    expect(vidCookie).toContain("Max-Age=33696000"); // 390 days
    expect(33696000 / 86400).toBeLessThan(396); // 13 months
  });

  it("optout: never extends an existing cookie on later visits", () => {
    const px = loadPixel({ cookies: { _al_vid: "existingvisitor01" } });
    px.tick();
    expect(px.beacons[0].vid).toBe("existingvisitor01");
    expect(px.cookieWrites.filter((c) => c.startsWith("_al_vid="))).toHaveLength(0);
  });

  it("required: no cookie, no storage and nothing sent before consent(true)", () => {
    const px = loadPixel({ consent: "required" });
    px.api.track("viewed_pricing");
    px.api.lead({ email: "jane@acme.test" }, "Demo");
    px.tick();
    expect(px.beacons).toHaveLength(0);
    expect(px.cookieWrites).toHaveLength(0);
    expect(px.storageWrites).toHaveLength(0);
    expect(px.api.getVisitorId()).toBeNull();

    // The visitor agrees: the events held in memory (incl. the landing page with its gclid) go out once.
    px.api.consent(true);
    px.tick();
    const events = px.beacons.flatMap((b) => b.events);
    expect(events.map((e) => e.t)).toEqual(["page_view", "custom", "lead"]);
    expect(px.beacons.every((b) => b.consent === "granted" && b.vid === px.api.getVisitorId())).toBe(true);
    expect(px.jar.get("_al_consent")).toBe("1");
    expect(px.jar.has("_al_vid")).toBe(true);
  });

  it("required: a refusal drops what was held and stores nothing", () => {
    const px = loadPixel({ consent: "required" });
    px.api.consent(false);
    px.api.track("x");
    px.tick();
    expect(px.beacons).toHaveLength(0);
    expect(px.cookieWrites.filter((c) => !c.includes("Max-Age=0"))).toHaveLength(0);
  });

  it("required: remembers a previous yes on the next page", () => {
    const px = loadPixel({ consent: "required", cookies: { _al_consent: "1", _al_vid: "returning000001" } });
    px.tick();
    expect(px.beacons[0]).toMatchObject({ vid: "returning000001", consent: "granted" });
  });

  it("cookieless: a per-page ID, no cookie or storage, no Meta browser IDs", () => {
    const px = loadPixel({ consent: "cookieless", cookies: { _fbp: "fb.1.1.123" } });
    px.tick();
    expect(px.beacons).toHaveLength(1);
    expect(px.beacons[0].vid).toMatch(/^[0-9a-f]{32}$/);
    expect(px.beacons[0].fbp).toBeNull();
    expect(px.cookieWrites).toHaveLength(0);
    expect(px.storageWrites).toHaveLength(0);
    const other = loadPixel({ consent: "cookieless" });
    other.tick();
    expect(other.beacons[0].vid).not.toBe(px.beacons[0].vid);
  });

  it("optout: consent(false) tells the server once, forgets the visitor and stops", () => {
    const px = loadPixel();
    px.tick();
    const vid = px.beacons[0].vid;
    px.api.consent(false);
    expect(px.beacons[1]).toMatchObject({ vid, consent: "denied", events: [] });
    px.api.track("after");
    px.tick();
    expect(px.beacons).toHaveLength(2);
    expect(px.jar.get("_al_consent")).toBe("0");
    expect(px.jar.has("_al_vid")).toBe(false);
  });

  it("sends Global Privacy Control with every batch", () => {
    const px = loadPixel({ gpc: true });
    px.tick();
    expect(px.beacons[0]).toMatchObject({ gpc: true });
  });
});

// ---------------------------------------------------------------- collect endpoint

describe("collect stores consent signals", () => {
  let db: DB;
  let ws: Workspace;
  const ctx = { origin: "https://shop.test", userAgent: "Mozilla/5.0", ip: "203.0.113.9" };
  const pv = (url = "https://shop.test/") => ({ t: "page_view" as const, url });

  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    await db.insert(schema.pixelSites).values([
      { workspaceId: ws.id, name: "US", publicKey: "pk_optout_000001" },
      { workspaceId: ws.id, name: "EU", publicKey: "pk_strict_000001", consentMode: "required" },
    ]);
  });
  const visitor = async (vid: string) =>
    (await db.select().from(schema.visitors).where(and(eq(schema.visitors.workspaceId, ws.id), eq(schema.visitors.anonymousId, vid))))[0];
  const collect = (p: Partial<CollectPayload>) => processCollect(db, collectSchema.parse({ site: "pk_optout_000001", events: [pv()], ...p }), ctx);

  it("validates: an empty batch is only accepted as a withdrawal", () => {
    expect(collectSchema.safeParse({ site: "pk_optout_000001", vid: "visitor000001", events: [] }).success).toBe(false);
    expect(collectSchema.safeParse({ site: "pk_optout_000001", vid: "visitor000001", consent: "denied", events: [] }).success).toBe(true);
    expect(collectSchema.safeParse({ site: "pk_optout_000001", vid: "visitor000001", consent: "maybe", events: [pv()] }).success).toBe(false);
  });

  it("stores consent and GPC on the visitor; an explicit answer survives an 'unknown'", async () => {
    await collect({ vid: "visitor-gpc-01", consent: "unknown", gpc: true });
    expect(await visitor("visitor-gpc-01")).toMatchObject({ consent: "unknown", gpc: true });
    await collect({ vid: "visitor-gpc-01", consent: "granted", gpc: false });
    await collect({ vid: "visitor-gpc-01", consent: "unknown" }); // older pixel build: no gpc field
    expect(await visitor("visitor-gpc-01")).toMatchObject({ consent: "granted", gpc: false });
  });

  it("carries a yes and a withdrawal to the contact", async () => {
    const vid = "visitor-yes-01";
    await collect({ vid, consent: "granted", events: [{ t: "identify", url: "https://shop.test/", traits: { email: "Ana@Example.test" } }] });
    const contact = async () => (await db.select().from(schema.contacts).where(eq(schema.contacts.emailHash, hashEmail("ana@example.test"))))[0];
    expect((await contact()).adsConsent).toBe("granted");

    const r = await collect({ vid, consent: "denied", events: [] });
    expect(r).toMatchObject({ ok: true, newLeads: 0 });
    expect(await visitor(vid)).toMatchObject({ consent: "denied" });
    expect((await contact()).adsConsent).toBe("denied");
  });

  it("strict (required) sites drop anything sent without consent, even from an outdated snippet", async () => {
    const r = await processCollect(db, collectSchema.parse({ site: "pk_strict_000001", vid: "visitor-eu-01", events: [pv()] }), ctx);
    expect(r).toMatchObject({ ok: true });
    expect(await visitor("visitor-eu-01")).toBeUndefined();
    await processCollect(db, collectSchema.parse({ site: "pk_strict_000001", vid: "visitor-eu-01", consent: "granted", events: [pv()] }), ctx);
    expect(await visitor("visitor-eu-01")).toMatchObject({ consent: "granted" });
  });

  it("classifies a ChatGPT referral as the AI assistants channel", async () => {
    await collect({ vid: "visitor-ai-01", events: [{ t: "page_view", url: "https://shop.test/pricing?utm_source=chatgpt.com" }] });
    const v = await visitor("visitor-ai-01");
    const [tp] = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.visitorId, v.id));
    expect(tp.channel).toBe("ai_assistant");
  });
});
