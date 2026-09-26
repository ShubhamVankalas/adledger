import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { eq } from "drizzle-orm";
import { buildSync } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as collect } from "@/app/api/v1/collect/route";
import { GET as waVerify, POST as waHook } from "@/app/api/v1/webhooks/whatsapp/[workspaceId]/route";
import {
  REF_ALPHABET,
  extractRefCode,
  generateRefCode,
  parseWhatsAppWebhook,
  verifySubscription,
  verifyWhatsAppSignature,
  whatsappIntegration,
} from "@/lib/connectors/leads-whatsapp";
import { allIntegrations } from "@/lib/connectors/registry";
import { hashPhone } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { saveConnection, type Workspace } from "@/lib/settings";
import { findVisitorByRef } from "@/lib/tracking/whatsapp";
import { setupWorkspace } from "./helpers";

const raw = (name: string) => readFileSync(`fixtures/whatsapp/${name}`, "utf8");
const APP_SECRET = "wa_app_secret_test";
const sign = (body: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("reference codes", () => {
  it("generates AL-XXXXX codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRefCode();
      expect(code).toMatch(/^AL-[2-9A-HJ-NP-Z]{5}$/);
      expect(extractRefCode(`Hello\n\nRef: ${code}`)).toBe(code);
    }
    expect(REF_ALPHABET).toHaveLength(32);
    expect(generateRefCode(() => 0)).toBe("AL-22222");
    expect(generateRefCode(() => 0.9999)).toBe("AL-ZZZZZ");
  });

  it("extracts codes from message text", () => {
    expect(extractRefCode("Hi, interested!\n\nRef: AL-7F3K9")).toBe("AL-7F3K9");
    expect(extractRefCode("ref al-7f3k9 thanks")).toBe("AL-7F3K9");
    expect(extractRefCode("Is the shop open?")).toBeNull();
    expect(extractRefCode("AL-7F3K")).toBeNull(); // too short
    expect(extractRefCode("AL-7F3K9X")).toBeNull(); // too long
    expect(extractRefCode("AL-0O1I2")).toBeNull(); // ambiguous characters are never generated
    expect(extractRefCode(null)).toBeNull();
  });
});

describe("WhatsApp webhook verification", () => {
  it("accepts a valid X-Hub-Signature-256 and rejects tampering", () => {
    const body = raw("message_with_ref.json");
    expect(verifyWhatsAppSignature(body, APP_SECRET, sign(body))).toBe(true);
    expect(verifyWhatsAppSignature(body.replace("3BHK", "2BHK"), APP_SECRET, sign(body))).toBe(false);
    expect(verifyWhatsAppSignature(body, APP_SECRET, sign(body, "wrong"))).toBe(false);
    expect(verifyWhatsAppSignature(body, APP_SECRET, sign(body).slice(7))).toBe(false); // missing sha256=
    expect(verifyWhatsAppSignature(body, APP_SECRET, "sha256=zz")).toBe(false);
    expect(verifyWhatsAppSignature(body, APP_SECRET, null)).toBe(false);
    expect(verifyWhatsAppSignature(body, undefined, sign(body))).toBe(false);
  });

  it("answers the subscription handshake only with the right verify token", () => {
    const q = (token: string, mode = "subscribe", challenge = "1158201444") =>
      new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge });
    expect(verifySubscription(q("my-token"), "my-token")).toBe("1158201444");
    expect(verifySubscription(q("nope"), "my-token")).toBeNull();
    expect(verifySubscription(q("my-token", "unsubscribe"), "my-token")).toBeNull();
    expect(verifySubscription(q("my-token", "subscribe", "<script>"), "my-token")).toBeNull();
    expect(verifySubscription(q("my-token"), undefined)).toBeNull();
  });
});

describe("WhatsApp payload parsing", () => {
  it("parses inbound messages exactly", () => {
    expect(parseWhatsAppWebhook(JSON.parse(raw("message_with_ref.json")))).toEqual([
      {
        messageId: "wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhggQkU4RTg0QjYzQjdBMjUwMjhFNzZBNUQ1MjE0RjdEQzYA",
        from: "919876543210",
        name: "Priya Sharma",
        text: "Hi, I'd like to know more about the 3BHK listing.\n\nRef: AL-7F3K9",
        ref: "AL-7F3K9",
        occurredAt: new Date(1790000000 * 1000),
        phoneNumberId: "106540352242922",
      },
    ]);
    const [noRef] = parseWhatsAppWebhook(JSON.parse(raw("message_without_ref.json")));
    expect(noRef).toMatchObject({ from: "919812345678", name: "Rahul Verma", ref: null });
    expect(parseWhatsAppWebhook(JSON.parse(raw("status_delivered.json")))).toEqual([]);
    expect(parseWhatsAppWebhook({ object: "page", entry: [] })).toEqual([]);
  });

  it("is listed in the catalog as a leads integration with secret fields", () => {
    expect(allIntegrations().find((i) => i.provider === "whatsapp")).toBe(whatsappIntegration);
    expect(whatsappIntegration.category).toBe("leads");
    const secrets = whatsappIntegration.fields.filter((f) => f.secret).map((f) => f.name);
    expect(secrets).toEqual(["appSecret", "verifyToken"]);
  });
});

// ---------------------------------------------------------------- pixel (run the real bundle)

type Listener = (e: unknown) => void;

function loadPixel(pageUrl: string) {
  const { outputFiles } = buildSync({ entryPoints: ["pixel/al.ts"], bundle: true, write: false, format: "iife", target: ["es2018"] });
  const beacons: { site: string; vid: string; events: { t: string; name?: string; props?: Record<string, unknown> }[] }[] = [];
  const opened: string[] = [];
  const docListeners: Record<string, Listener[]> = {};
  const jar = new Map<string, string>();
  const url = new URL(pageUrl);
  const document = {
    currentScript: { src: "https://adledger.test/p/al.js", getAttribute: (k: string) => (k === "data-site" ? "pk_whatsapp0001" : null) },
    querySelector: () => null,
    referrer: "",
    visibilityState: "visible",
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(s: string) {
      const [kv, ...attrs] = s.split(";");
      const [k, v] = kv.split("=");
      if (attrs.some((a) => a.trim() === "Max-Age=0")) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    },
    addEventListener: (type: string, fn: Listener) => (docListeners[type] ??= []).push(fn),
  };
  class FakeBlob {
    constructor(public parts: string[]) {}
  }
  const sandbox: Record<string, unknown> = {
    document,
    location: { href: pageUrl, protocol: url.protocol, hostname: url.hostname },
    history: { pushState() {}, replaceState() {} },
    navigator: {
      sendBeacon: (_u: string, b: FakeBlob) => {
        beacons.push(JSON.parse(b.parts.join("")));
        return true;
      },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    open: (u: string) => {
      opened.push(u);
      return {};
    },
    setTimeout,
    clearTimeout,
    URL,
    Blob: FakeBlob,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(outputFiles[0].text, sandbox);
  const click = (href: string, attrs: string[] = []) => {
    const a = { href, hasAttribute: (n: string) => attrs.includes(n) };
    for (const fn of docListeners.click ?? []) fn({ target: { closest: () => a } });
    return a.href;
  };
  const api = sandbox.adledger as { whatsapp(n: string, m?: string): string; getVisitorId(): string };
  return { beacons, opened, click, api };
}

describe("pixel WhatsApp / call tracking", () => {
  it("tags wa.me links with a reference code and records the click", () => {
    const px = loadPixel("https://shop.test/");
    const href = px.click("https://wa.me/919876543210?text=Hi%20there");
    const text = new URL(href).searchParams.get("text")!;
    const code = extractRefCode(text)!;
    expect(code).toMatch(/^AL-[2-9A-HJ-NP-Z]{5}$/);
    expect(text).toBe(`Hi there\n\nRef: ${code}`);
    expect(href).not.toContain("+");
    const ev = px.beacons.flatMap((b) => b.events).find((e) => e.name === "whatsapp_click");
    expect(ev).toMatchObject({ t: "custom", props: { to: "919876543210", ref: code } });

    // Clicking again replaces the code instead of stacking them.
    const again = new URL(px.click(href)).searchParams.get("text")!;
    expect(again.match(/Ref: /g)).toHaveLength(1);
  });

  it("handles api.whatsapp.com, whatsapp://, opt-out links and tel: links", () => {
    const px = loadPixel("https://shop.test/");
    expect(extractRefCode(new URL(px.click("https://api.whatsapp.com/send?phone=919876543210")).searchParams.get("text"))).not.toBeNull();
    expect(px.click("whatsapp://send?phone=919876543210&text=Hello")).toMatch(/text=Hello%0A%0ARef%3A%20AL-/);
    expect(px.click("https://wa.me/919876543210?text=Hi", ["data-adledger-noref"])).toBe("https://wa.me/919876543210?text=Hi");
    expect(px.click("https://example.com/contact")).toBe("https://example.com/contact");
    px.click("tel:+91%2098765%2043210");
    const events = px.beacons.flatMap((b) => b.events);
    expect(events.filter((e) => e.name === "whatsapp_click").map((e) => e.props?.to)).toEqual(["919876543210", "919876543210", "919876543210"]);
    expect(events.find((e) => e.name === "call_click")?.props).toEqual({ to: "+919876543210" });
  });

  it("adledger.whatsapp() opens a tagged chat", () => {
    const px = loadPixel("https://shop.test/");
    const url = px.api.whatsapp("+91 98765 43210", "Hi! I saw your ad");
    expect(px.opened).toEqual([url]);
    expect(url.startsWith("https://wa.me/919876543210?text=Hi%21%20I%20saw%20your%20ad%0A%0ARef%3A%20AL-")).toBe(true);
    const code = extractRefCode(new URL(url).searchParams.get("text"));
    expect(px.beacons.flatMap((b) => b.events).find((e) => e.name === "whatsapp_click")?.props?.ref).toBe(code);
  });
});

// ---------------------------------------------------------------- end to end

describe("WhatsApp webhook route", () => {
  let db: DB;
  let ws: Workspace;
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
  const params = () => Promise.resolve({ workspaceId: ws.id });
  const post = (body: string, sig = sign(body)) =>
    waHook(new Request(`http://localhost/api/v1/webhooks/whatsapp/${ws.id}`, { method: "POST", body, headers: { "x-hub-signature-256": sig } }), { params: params() });

  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "Site", domains: "", publicKey: "pk_whatsapp0001" });
    await saveConnection(ws.id, "whatsapp", { mode: "live", secrets: { appSecret: APP_SECRET, verifyToken: "vt-123" }, config: { phoneNumberId: "106540352242922" } }, db);
  });

  it("verifies the subscription (GET)", async () => {
    const get = (qs: string) => waVerify(new Request(`http://localhost/api/v1/webhooks/whatsapp/${ws.id}?${qs}`), { params: params() });
    const ok = await get("hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=987654321");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("987654321");
    expect((await get("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1")).status).toBe(403);
    const unknown = await waVerify(new Request("http://localhost/x?hub.mode=subscribe"), { params: Promise.resolve({ workspaceId: "00000000-0000-0000-0000-000000000000" }) });
    expect(unknown.status).toBe(404);
  });

  it("rejects bad signatures without storing anything", async () => {
    const body = raw("message_with_ref.json");
    expect((await post(body, sign(body, "wrong"))).status).toBe(401);
    expect(await db.select().from(schema.leads)).toHaveLength(0);
  });

  it("pixel click -> WhatsApp message creates a contact + lead linked to the visitor's touchpoints", async () => {
    // 1. A visitor lands from a Meta ad and taps the WhatsApp button.
    const px = loadPixel("https://shop.test/flats?utm_source=facebook&utm_medium=paid_social&utm_campaign=diwali-flats&fbclid=IwAR123");
    const tagged = px.click("https://wa.me/919876543210?text=Hi");
    const code = extractRefCode(new URL(tagged).searchParams.get("text"))!;
    const beacon = px.beacons[0];
    expect(beacon.events.map((e) => e.t)).toEqual(["page_view", "custom"]);
    const c = await collect(
      new Request("http://localhost/api/v1/collect", { method: "POST", body: JSON.stringify(beacon), headers: { "content-type": "text/plain", "user-agent": UA, origin: "https://shop.test" } }),
    );
    expect(c.status).toBe(204);
    const [visitor] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, beacon.vid));
    expect(await findVisitorByRef(db, ws.id, code)).toBe(visitor.id);
    expect(await findVisitorByRef(db, ws.id, "AL-22222")).toBeNull();

    // 2. They send the prefilled message; WhatsApp calls the webhook.
    const payload = JSON.parse(raw("message_with_ref.json"));
    const msg = payload.entry[0].changes[0].value.messages[0];
    msg.text.body = msg.text.body.replace("AL-7F3K9", code);
    msg.timestamp = String(Math.floor(Date.now() / 1000) + 60);
    const body = JSON.stringify(payload);
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true, leads: 1, linked: 1 });

    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.workspaceId, ws.id));
    expect(contact).toMatchObject({ phoneHash: hashPhone("919876543210"), email: null, emailHash: null, name: "Priya Sharma" });
    const leads = await db.select().from(schema.leads);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ contactId: contact.id, source: "webhook", formName: "WhatsApp" });
    expect(leads[0].raw).toEqual({ channel: "whatsapp", ref: code, message_id: msg.id, visitor_matched: true });
    expect(JSON.stringify(leads[0].raw)).not.toContain("919876543210");

    const [linked] = await db.select().from(schema.visitors).where(eq(schema.visitors.id, visitor.id));
    expect(linked.contactId).toBe(contact.id);
    const tps = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.visitorId, visitor.id));
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ utmCampaign: "diwali-flats", clickIdType: "fbclid" });

    // 3. Retries and follow-ups quoting the same code don't duplicate the lead.
    expect(await (await post(body)).json()).toMatchObject({ leads: 0 });
    expect(await db.select().from(schema.leads)).toHaveLength(1);
  });

  it("ignores messages without a code, status updates and other business numbers", async () => {
    expect(await (await post(raw("message_without_ref.json"))).json()).toMatchObject({ received: true, leads: 0 });
    expect(await (await post(raw("status_delivered.json"))).json()).toMatchObject({ received: true, leads: 0 });
    const other = JSON.parse(raw("message_with_ref.json"));
    other.entry[0].changes[0].value.metadata.phone_number_id = "999999999999999";
    other.entry[0].changes[0].value.messages[0].text.body = "Ref: AL-ABCDE";
    expect(await (await post(JSON.stringify(other))).json()).toMatchObject({ leads: 0 });
    expect(await db.select().from(schema.leads)).toHaveLength(1);
  });
});
