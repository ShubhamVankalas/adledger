import { describe, expect, it } from "vitest";
import { extractTraits } from "@/lib/tracking/identity";
import { classify, parseMarketingParams, platformOf } from "@/lib/tracking/utm";
import { originAllowed, truncateIp, isBot } from "@/lib/tracking/collect";
import { redactPii } from "@/lib/crypto";

const ch = (url: string, ref: string | null = null) => {
  const p = parseMarketingParams(url);
  return classify(p, ref, new URL(url).hostname.replace(/^www\./, ""));
};

describe("UTM + click id parsing", () => {
  it("parses UTMs case-insensitively and picks the click id", () => {
    const p = parseMarketingParams("https://x.com/?UTM_SOURCE=facebook&utm_campaign=123&fbclid=abc");
    expect(p.utmSource).toBe("facebook");
    expect(p.utmCampaign).toBe("123");
    expect(p.clickIdType).toBe("fbclid");
    expect(p.clickId).toBe("abc");
  });
  it("tolerates malformed URLs", () => {
    expect(parseMarketingParams("not a url").utmSource).toBeNull();
  });
});

describe("channel rules", () => {
  it("classifies the acceptance example as paid_social", () => {
    expect(ch("http://localhost:8080/?utm_source=facebook&utm_campaign=123&fbclid=abc")).toBe("paid_social");
  });
  it("gclid / cpc -> paid_search", () => {
    expect(ch("https://a.com/?gclid=xyz")).toBe("paid_search");
    expect(ch("https://a.com/?utm_source=google&utm_medium=cpc")).toBe("paid_search");
    expect(ch("https://a.com/?utm_source=bing&utm_medium=ppc")).toBe("paid_search");
  });
  it("paid social mediums", () => {
    expect(ch("https://a.com/?utm_source=instagram&utm_medium=paid_social")).toBe("paid_social");
    expect(ch("https://a.com/?utm_source=tiktok&utm_medium=cpc")).toBe("paid_social");
    expect(ch("https://a.com/?ttclid=1")).toBe("paid_social");
  });
  it("AI assistants get their own channel, split out of organic", () => {
    for (const ref of ["https://chatgpt.com/", "https://chat.openai.com/c/1", "https://www.perplexity.ai/search?q=x", "https://gemini.google.com/app", "https://copilot.microsoft.com/", "https://claude.ai/chat/1"]) {
      expect(ch("https://a.com/", ref)).toBe("ai_assistant");
    }
    expect(ch("https://a.com/pricing?utm_source=chatgpt.com")).toBe("ai_assistant"); // ChatGPT tags its links
    expect(ch("https://a.com/?utm_source=perplexity")).toBe("ai_assistant");
    // Google search is still organic; a paid campaign that names an AI source is still paid.
    expect(ch("https://a.com/", "https://www.google.com/")).toBe("organic");
    expect(ch("https://a.com/", "https://mail.google.com/")).toBe("organic");
    expect(ch("https://a.com/?utm_source=chatgpt&utm_medium=cpc")).toBe("paid_search");
    expect(ch("https://a.com/", "https://notclaude.ai/")).toBe("referral");
  });
  it("email and organic", () => {
    expect(ch("https://a.com/?utm_source=newsletter&utm_medium=email")).toBe("email");
    expect(ch("https://a.com/", "https://www.google.com/")).toBe("organic");
    expect(ch("https://a.com/", "https://t.co/abc")).toBe("organic");
    expect(ch("https://a.com/?utm_source=linkedin&utm_medium=social")).toBe("organic");
  });
  it("referral vs no signal", () => {
    expect(ch("https://a.com/", "https://news.ycombinator.com/")).toBe("referral");
    expect(ch("https://a.com/pricing", "https://a.com/")).toBeNull(); // internal navigation
    expect(ch("https://a.com/")).toBeNull(); // direct
  });
  it("guesses the ad platform", () => {
    expect(platformOf(parseMarketingParams("https://a.com/?utm_source=ig"))).toBe("meta");
    expect(platformOf(parseMarketingParams("https://a.com/?gbraid=1"))).toBe("google");
    expect(platformOf(parseMarketingParams("https://a.com/?utm_source=newsletter"))).toBeNull();
  });
});

describe("collect helpers", () => {
  it("truncates IPs", () => {
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0");
    expect(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
    expect(truncateIp("198.51.100.4, 10.0.0.1")).toBe("198.51.100.0");
  });
  it("checks allowed origins incl. subdomains", () => {
    expect(originAllowed("", "https://anything.com")).toBe(true);
    expect(originAllowed("acme.com", "https://www.acme.com")).toBe(true);
    expect(originAllowed("acme.com", "https://shop.acme.com")).toBe(true);
    expect(originAllowed("acme.com", "https://evilacme.com")).toBe(false);
    expect(originAllowed("https://acme.com/", null)).toBe(false);
  });
  it("detects bots", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  });
});

describe("form payload trait extraction", () => {
  it("finds email/phone/name in flat forms", () => {
    expect(extractTraits({ Email: "Jane@Acme.com", phone_number: "+1 555 123 4567", name: "Jane" })).toMatchObject({
      email: "Jane@Acme.com",
      phone: "+1 555 123 4567",
      name: "Jane",
    });
  });
  it("finds fields in Typeform-style payloads", () => {
    const typeform = {
      form_response: {
        answers: [
          { type: "text", text: "Jane Doe", field: { ref: "name" } },
          { type: "email", email: "jane@acme.com", field: { ref: "email" } },
          { type: "phone_number", phone_number: "+15551234567", field: { ref: "phone" } },
        ],
        hidden: { al_vid: "vid123456789" },
      },
    };
    expect(extractTraits(typeform)).toMatchObject({ email: "jane@acme.com", phone: "+15551234567", vid: "vid123456789" });
  });
  it("uses an explicit field mapping first", () => {
    expect(extractTraits({ a: { b: "x@y.co" }, email: "other@z.co" }, { email: "a.b" }).email).toBe("x@y.co");
  });
});

describe("PII redaction", () => {
  it("hashes emails and phone-like fields", () => {
    const out = redactPii({ email: "a@b.co", nested: [{ contact: "Jane <c@d.io>" }], phone: "+1 555 000 1111", note: "hi" }) as Record<string, unknown>;
    expect(String(out.email)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(String(out.phone)).toMatch(/^sha256:/);
    expect(out.note).toBe("hi");
  });
});
