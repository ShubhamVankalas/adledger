import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLlmConfig } from "@/lib/ai/report";
import { CsvLimitError, parseCsv } from "@/lib/imports";
import { BlockedUrlError, assertSafeHost, assertSafeUrl, checkOutboundUrl, guardedFetch, isPrivateIp, safeFetch, setLookupForTests } from "@/lib/net";
import { sendEmail } from "@/lib/notify/channels/email";
import { slackDriver } from "@/lib/notify/channels/slack";
import { webhookDriver } from "@/lib/notify/channels/webhook";
import { BodyTooLargeError, isSameOriginRequest, rateLimit, readTextLimited, resetRateLimits } from "@/lib/http";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "@/lib/security-headers";
import { safeRedirectPath } from "@/lib/url";
import type { Workspace } from "@/lib/settings";
import nextConfig from "../next.config";

// Pure security helpers: SSRF guard, redirects, body/CSV limits, CSRF check, headers.

const PUBLIC_IP = "93.184.216.34";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setLookupForTests(async (host) => (host.startsWith("internal.") ? ["10.1.2.3"] : host.startsWith("v6.") ? ["::ffff:169.254.169.254"] : [PUBLIC_IP]));
  fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setLookupForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("SSRF guard", () => {
  it("classifies private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.17.0.1", "192.168.1.10", "100.64.0.1", "0.0.0.0", "::1", "fd00:ec2::254", "fe80::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", PUBLIC_IP, "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("blocks private targets for notification/store URLs, including via DNS", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("http://localhost:5432")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("http://metadata.google.internal/computeMetadata/v1/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("http://[::1]:3000/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("https://internal.example.com/hook")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("https://v6.example.com/hook")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("https://user:pw@hooks.example.com/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("https://hooks.slack.com/services/T/B/X")).resolves.toBeInstanceOf(URL);
    await expect(assertSafeHost("10.0.0.5")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("lets LLM base URLs use localhost and host.docker.internal, but not metadata or the LAN", async () => {
    expect(await checkOutboundUrl("http://localhost:11434/v1", "llm")).toBeNull();
    expect(await checkOutboundUrl("http://127.0.0.1:1234/v1", "llm")).toBeNull();
    expect(await checkOutboundUrl("http://host.docker.internal:11434", "llm")).toBeNull();
    expect(await checkOutboundUrl("http://169.254.169.254/v1", "llm")).toMatch(/private network/);
    expect(await checkOutboundUrl("http://192.168.1.20:11434/v1", "llm")).toMatch(/ALLOW_PRIVATE_URLS/);
    // Loopback is still blocked for everything that isn't an LLM base URL.
    expect(await checkOutboundUrl("http://localhost:11434/v1")).toMatch(/private or internal/);
  });

  it("ALLOW_PRIVATE_URLS=true turns the check off", async () => {
    vi.stubEnv("ALLOW_PRIVATE_URLS", "true");
    expect(await checkOutboundUrl("http://192.168.1.20:5678/webhook")).toBeNull();
    expect(await checkOutboundUrl("http://169.254.169.254/")).toBeNull();
  });

  it("re-checks redirects and never follows them for POST", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/start") ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }) : new Response("ok"),
    );
    await expect(safeFetch("https://shop.example.com/start")).rejects.toBeInstanceOf(BlockedUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });

    fetchMock.mockClear();
    const res = await safeFetch("https://shop.example.com/start", { method: "POST", body: "{}" });
    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/old") ? new Response(null, { status: 301, headers: { location: "/new" } }) : new Response("moved ok"),
    );
    expect(await (await safeFetch("https://shop.example.com/old")).text()).toBe("moved ok");
  });

  it("notification channels refuse internal URLs without sending anything", async () => {
    const msg = { title: "t", text: "x", severity: "info" as const };
    await expect(webhookDriver.send({ config: { url: "http://169.254.169.254/latest" }, secrets: {} }, msg)).rejects.toThrow(/blocked/);
    await expect(slackDriver.send({ config: {}, secrets: { webhookUrl: "http://10.0.0.8/hook" } }, msg)).rejects.toThrow(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      sendEmail({ to: "a@example.com", msg, conn: { config: { host: "127.0.0.1", from: "a@example.com" }, secrets: {} } }),
    ).rejects.toThrow(/private or internal/);
    await webhookDriver.send({ config: { url: "https://example.com/hook" }, secrets: {} }, msg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("guards the fetch used for dashboard-configured LLMs; env-configured ones are trusted", async () => {
    const f = guardedFetch("llm");
    await expect(f("http://169.254.169.254/v1/chat/completions", { method: "POST" })).rejects.toBeInstanceOf(BlockedUrlError);
    await f("http://localhost:11434/v1/chat/completions", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubEnv("LLM_MODEL", "ollama/llama3.1");
    vi.stubEnv("LLM_API_BASE", "http://10.0.0.9:11434/v1");
    // No dashboard setting for this workspace: the operator's env config applies and is trusted.
    const cfg = await getLlmConfig({ id: "00000000-0000-0000-0000-000000000000" } as Workspace);
    expect(cfg).toMatchObject({ provider: "ollama", model: "llama3.1", trusted: true });
  });
});

describe("redirects after sign-in", () => {
  it("only allows same-site paths", () => {
    expect(safeRedirectPath("/performance?range=7d")).toBe("/performance?range=7d");
    expect(safeRedirectPath("/settings#members")).toBe("/settings#members");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "\\\\evil.test", "javascript:alert(1)", "/\tevil", "", null, 42]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/");
    }
  });
});

describe("request limits", () => {
  it("refuses bodies over the limit, by header or while streaming", async () => {
    await expect(readTextLimited(new Request("http://x/", { method: "POST", body: "a".repeat(11) }), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    const declared = new Request("http://x/", { method: "POST", body: "tiny", headers: { "content-length": "999999" } });
    await expect(readTextLimited(declared, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readTextLimited(new Request("http://x/", { method: "POST", body: "héllo" }), 10)).toBe("héllo");
  });

  it("token-bucket rate limiter", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(rateLimit("t:key", 3)).toBe(true);
    expect(rateLimit("t:key", 3)).toBe(false);
    expect(rateLimit("t:other", 3)).toBe(true);
  });

  it("CSV parser enforces row, column and value limits", () => {
    const limits = { rows: 2, columns: 3, fieldChars: 5 };
    expect(parseCsv("a,b\n1,2\n3,4\n", limits)).toHaveLength(2);
    expect(() => parseCsv("a,b\n1,2\n3,4\n5,6\n", limits)).toThrow(CsvLimitError);
    expect(() => parseCsv("a,b,c,d\n1,2,3,4\n", limits)).toThrow(/columns/);
    expect(() => parseCsv("a\n123456\n", limits)).toThrow(/longer than/);
  });
});

describe("CSRF check for cookie-authenticated writes", () => {
  const req = (h: Record<string, string>) => new Request("https://app.example.com/api/v1/spend", { method: "POST", headers: { host: "app.example.com", ...h } });
  it("accepts same-origin and rejects cross-site requests", () => {
    expect(isSameOriginRequest(req({ origin: "https://app.example.com" }))).toBe(true);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(req({ origin: "https://evil.test" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://app.example.com", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(req({}))).toBe(false);
  });
});

describe("security headers", () => {
  it("sends a CSP that still lets Next.js run, plus framing/sniffing protections", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src 'self' 'unsafe-inline'/);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval"); // tests run with NODE_ENV=test
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]));
  });

  it("adds HSTS only for HTTPS requests and keeps the pixel/webhooks free of the CSP", async () => {
    const rules = await nextConfig.headers!();
    const hsts = rules.find((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"));
    expect(hsts?.has).toEqual([{ type: "header", key: "x-forwarded-proto", value: "https" }]);
    const csp = rules.find((r) => r.headers.some((h) => h.key === "Content-Security-Policy"));
    expect(csp?.source).toContain("?!p/|api/v1/collect|api/v1/webhooks");
  });
});
