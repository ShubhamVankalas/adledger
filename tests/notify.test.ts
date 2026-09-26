import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationMessage } from "@/lib/connectors/types";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn<(opts: unknown) => { sendMail: typeof sendMail }>(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport }, createTransport }));

import { NOTIFICATION_DRIVERS } from "@/lib/notify/channels";
import { discordDriver } from "@/lib/notify/channels/discord";
import { emailDriver, renderEmail, sendEmail } from "@/lib/notify/channels/email";
import { slackDriver } from "@/lib/notify/channels/slack";
import { SMS_MAX_CHARS, smsDriver, smsText } from "@/lib/notify/channels/sms";
import { teamsDriver } from "@/lib/notify/channels/teams";
import { signPayload, webhookDriver } from "@/lib/notify/channels/webhook";
import { parseBlocks, toHtml, toPlain, toSlackMrkdwn } from "@/lib/notify/format";

const msg: NotificationMessage = {
  title: "ROAS dropped on Summer Sale",
  text: "Spend is up but revenue is **flat** today.\n\n- Campaign: Summer Sale\n- Ad: UGC video #3",
  severity: "warning",
  url: "https://adledger.example.com/ads/123",
  fields: [
    { label: "Spend", value: "$412.37" },
    { label: "Revenue", value: "$98.00" },
    { label: "ROAS", value: "0.24x" },
  ],
};

type Call = { url: string; init: RequestInit };
let calls: Call[];
let nextResponse: () => Response;

beforeEach(() => {
  calls = [];
  nextResponse = () => new Response("ok", { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return nextResponse();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sendMail.mockReset();
  createTransport.mockClear();
});

const jsonBody = (c: Call) => JSON.parse(String(c.init.body));
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("format helpers", () => {
  it("parses paragraphs and bullets", () => {
    expect(parseBlocks("a\nb\n\n- x\n- y\nc")).toEqual([
      { kind: "p", lines: ["a", "b"] },
      { kind: "ul", items: ["x", "y"] },
      { kind: "p", lines: ["c"] },
    ]);
  });
  it("converts to html / slack / plain", () => {
    expect(toHtml("**hi** <b>\n\n- one")).toBe("<p><strong>hi</strong> &lt;b&gt;</p>\n<ul><li>one</li></ul>");
    expect(toSlackMrkdwn("**hi** <@U1>\n- one")).toBe("*hi* &lt;@U1&gt;\n\n• one");
    expect(toPlain("**hi**\n- one")).toBe("hi\n\n- one");
  });
});

describe("registry", () => {
  it("registers all six drivers with valid meta", () => {
    expect(NOTIFICATION_DRIVERS.map((d) => d.type).sort()).toEqual(["discord", "email", "slack", "sms", "teams", "webhook"]);
    for (const d of NOTIFICATION_DRIVERS) {
      expect(d.meta.provider).toBe(`notify_${d.type}`);
      expect(d.meta.category).toBe("notifications");
      expect(d.meta.steps.length).toBeGreaterThanOrEqual(2);
      expect(d.meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("slack", () => {
  it("posts Block Kit to the webhook", async () => {
    const hook = "https://hooks.slack.com/services/T/B/secret";
    await slackDriver.send({ config: {}, secrets: { webhookUrl: hook } }, msg);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe(hook);
    expect(c.init.method).toBe("POST");
    expect(header(c, "Content-Type")).toBe("application/json");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    const body = jsonBody(c);
    expect(body.text).toContain(msg.title);
    const types = body.blocks.map((b: { type: string }) => b.type);
    expect(types).toEqual(["header", "section", "section", "context", "actions"]);
    expect(body.blocks[0].text.text).toBe(msg.title);
    expect(body.blocks[1].text.text).toContain("*flat*");
    expect(body.blocks[1].text.text).not.toContain("**");
    expect(body.blocks[1].text.text).toContain("• Campaign: Summer Sale");
    expect(body.blocks[2].fields).toHaveLength(3);
    expect(body.blocks[2].fields[0].text).toBe("*Spend*\n$412.37");
    expect(body.blocks[3].elements[0].text).toContain("⚠️");
    expect(body.blocks[4].elements[0].url).toBe(msg.url);
  });

  it("throws with status + snippet but never the webhook URL", async () => {
    const hook = "https://hooks.slack.com/services/T/B/supersecret";
    nextResponse = () => new Response(`invalid_token for ${hook}`, { status: 403 });
    const err = await slackDriver.send({ config: {}, secrets: { webhookUrl: hook } }, msg).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("HTTP 403");
    expect((err as Error).message).toContain("invalid_token");
    expect((err as Error).message).not.toContain("supersecret");
  });

  it("throws when not configured", async () => {
    await expect(slackDriver.send({ config: {}, secrets: {} }, msg)).rejects.toThrow(/webhook URL is not set/);
    expect(calls).toHaveLength(0);
  });
});

describe("discord", () => {
  it("posts an embed colored by severity", async () => {
    nextResponse = () => new Response(null, { status: 204 });
    const hook = "https://discord.com/api/webhooks/1/abc";
    await discordDriver.send({ config: {}, secrets: { webhookUrl: hook } }, { ...msg, severity: "critical" });
    const [c] = calls;
    expect(c.url).toBe(hook);
    expect(c.init.method).toBe("POST");
    const body = jsonBody(c);
    expect(body.embeds).toHaveLength(1);
    const e = body.embeds[0];
    expect(e.title).toBe(msg.title);
    expect(e.description).toBe(msg.text);
    expect(e.color).toBe(0xdc2626);
    expect(e.url).toBe(msg.url);
    expect(e.fields).toEqual(msg.fields!.map((f) => ({ name: f.label, value: f.value, inline: true })));
  });
});

describe("teams", () => {
  it("posts an Adaptive Card message", async () => {
    nextResponse = () => new Response("", { status: 202 });
    const hook = "https://prod-00.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=xyz";
    await teamsDriver.send({ config: {}, secrets: { webhookUrl: hook } }, msg);
    const [c] = calls;
    expect(c.url).toBe(hook);
    const body = jsonBody(c);
    expect(body.type).toBe("message");
    expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    const card = body.attachments[0].content;
    expect(card.type).toBe("AdaptiveCard");
    expect(card.body.some((b: { text?: string }) => b.text === msg.title)).toBe(true);
    const facts = card.body.find((b: { type: string }) => b.type === "FactSet").facts;
    expect(facts[0]).toEqual({ title: "Spend", value: "$412.37" });
    expect(card.actions[0]).toMatchObject({ type: "Action.OpenUrl", url: msg.url });
  });
});

describe("webhook", () => {
  it("posts JSON with a verifiable HMAC signature", async () => {
    const secret = "whsec_test_123";
    await webhookDriver.send({ config: { url: "https://example.com/hook" }, secrets: { signingSecret: secret } }, msg);
    const [c] = calls;
    expect(c.url).toBe("https://example.com/hook");
    expect(c.init.method).toBe("POST");
    const raw = String(c.init.body);
    const body = JSON.parse(raw);
    expect(body).toMatchObject({ title: msg.title, text: msg.text, severity: "warning", url: msg.url, fields: msg.fields });
    expect(new Date(body.sentAt).toString()).not.toBe("Invalid Date");
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    expect(header(c, "X-AdLedger-Signature")).toBe(`sha256=${expected}`);
    expect(signPayload(raw, secret)).toBe(expected);
  });

  it("omits the signature without a secret", async () => {
    await webhookDriver.send({ config: { url: "https://example.com/hook" }, secrets: {} }, msg);
    expect(header(calls[0], "X-AdLedger-Signature")).toBeUndefined();
  });

  it("reports HTTP errors", async () => {
    nextResponse = () => new Response("boom", { status: 500 });
    await expect(
      webhookDriver.send({ config: { url: "https://example.com/hook" }, secrets: {} }, msg),
    ).rejects.toThrow("Webhook returned HTTP 500: boom");
  });
});

describe("sms (twilio)", () => {
  it("posts form-encoded messages with basic auth, one per recipient", async () => {
    nextResponse = () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    const conn = {
      config: { accountSid: "AC123", from: "+15551234567", to: "+15550000001, +15550000002" },
      secrets: { authToken: "tok_secret" },
    };
    await smsDriver.send(conn, msg);
    expect(calls).toHaveLength(2);
    const [c] = calls;
    expect(c.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(c.init.method).toBe("POST");
    expect(header(c, "Authorization")).toBe(`Basic ${Buffer.from("AC123:tok_secret").toString("base64")}`);
    expect(header(c, "Content-Type")).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(c.init.body));
    expect(form.get("To")).toBe("+15550000001");
    expect(form.get("From")).toBe("+15551234567");
    const text = form.get("Body")!;
    expect(text).toContain(msg.title);
    expect(text).toContain("Spend: $412.37");
    expect(text).toContain("Revenue: $98.00");
    expect(text).not.toContain("ROAS: 0.24x");
    expect(text).toContain(msg.url);
    expect(new URLSearchParams(String(calls[1].init.body)).get("To")).toBe("+15550000002");
  });

  it("truncates to 320 chars and keeps the link", () => {
    const text = smsText({ ...msg, title: "x".repeat(1000) });
    expect(text.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(text.endsWith(msg.url!)).toBe(true);
  });

  it("errors never include the auth token", async () => {
    nextResponse = () => new Response(JSON.stringify({ code: 20003, message: "Authenticate" }), { status: 401 });
    const err = (await smsDriver
      .send({ config: { accountSid: "AC123", from: "+1555", to: "+1666" }, secrets: { authToken: "tok_secret" } }, msg)
      .catch((e: Error) => e)) as Error;
    expect(err.message).toContain("HTTP 401");
    expect(err.message).toContain("Authenticate");
    expect(err.message).not.toContain("tok_secret");
  });
});

describe("email", () => {
  it("renders title, fields, button, and escapes user HTML", () => {
    const r = renderEmail({
      ...msg,
      title: "Alert <script>alert(1)</script>",
      text: "Hello <img src=x onerror=alert(1)> **bold**\n- item <b>",
      fields: [{ label: "Campaign <i>", value: "\"Summer\" & <Sale>" }],
    });
    expect(r.subject).toBe("[Warning] Alert <script>alert(1)</script>");
    expect(r.html).toContain("Alert &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<img");
    expect(r.html).toContain("<strong>bold</strong>");
    expect(r.html).toMatch(/<li[^>]*>item &lt;b&gt;<\/li>/);
    expect(r.html).toContain("Campaign &lt;i&gt;");
    expect(r.html).toContain("&quot;Summer&quot; &amp; &lt;Sale&gt;");
    expect(r.html).toContain("#0f9d74");
    expect(r.html).toContain(`href="${msg.url}"`);
    expect(r.html).toContain("Open AdLedger");
    expect(r.text).toContain("Campaign <i>: \"Summer\" & <Sale>");
    expect(r.text).toContain("- item <b>");
    expect(r.text).not.toContain("**");
  });

  it("drops non-http links", () => {
    const r = renderEmail({ ...msg, url: "javascript:alert(1)" });
    expect(r.html).not.toContain("javascript:");
    expect(r.html).not.toContain("Open AdLedger");
  });

  it("sends through SMTP config", async () => {
    sendMail.mockResolvedValue({ messageId: "1" });
    await emailDriver.send(
      {
        config: { host: "smtp.example.com", port: "465", secure: "true", username: "u", from: "AdLedger <a@example.com>", to: "x@example.com, y@example.com" },
        secrets: { password: "pw" },
      },
      msg,
    );
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "u", pass: "pw" } }),
    );
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ from: "AdLedger <a@example.com>", to: "x@example.com, y@example.com", subject: `[Warning] ${msg.title}` });
    expect(mail.html).toContain(msg.title);
    expect(mail.text).toContain(msg.title);
  });

  it("falls back to SMTP_URL / SMTP_FROM", async () => {
    vi.stubEnv("SMTP_URL", "smtps://user:pass@mail.example.com");
    vi.stubEnv("SMTP_FROM", "noreply@example.com");
    sendMail.mockResolvedValue({});
    await sendEmail({ to: "invitee@example.com", subject: "You're invited", msg: { ...msg, severity: "info" } });
    expect(createTransport).toHaveBeenCalledWith("smtps://user:pass@mail.example.com");
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: "noreply@example.com", to: "invitee@example.com", subject: "You're invited" });
  });

  it("wraps SMTP errors without leaking the password", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("Invalid login for pw123secret"), { responseCode: 535 }));
    const err = (await emailDriver
      .send({ config: { host: "smtp.example.com", from: "a@example.com", to: "b@example.com", username: "u" }, secrets: { password: "pw123secret" } }, msg)
      .catch((e: Error) => e)) as Error;
    expect(err.message).toContain("SMTP 535");
    expect(err.message).not.toContain("pw123secret");
  });

  it("throws when nothing is configured", async () => {
    vi.stubEnv("SMTP_URL", "");
    await expect(sendEmail({ to: "a@example.com", msg })).rejects.toThrow(/not configured/);
  });
});
