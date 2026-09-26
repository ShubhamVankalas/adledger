import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Outbound request guard (SSRF). Anything that fetches a URL a dashboard user typed in
// (notification webhooks, Slack/Discord/Teams URLs, SMTP hosts, store URLs, LLM base URLs)
// goes through here so the server can't be pointed at the cloud metadata service, the
// database, or other machines on the private network.
//
// ALLOW_PRIVATE_URLS=true turns the check off (for installs that deliberately talk to
// services on their LAN). LLM base URLs additionally accept loopback and
// host.docker.internal so a local Ollama / LM Studio keeps working out of the box.
// Residual risk: the hostname is resolved here and again by fetch, so a DNS-rebinding
// attacker with a very short TTL could still race the check. Redirects are re-checked.

export type UrlPolicy = "public" | "llm";

export class BlockedUrlError extends Error {}

export const allowPrivateUrls = () => process.env.ALLOW_PRIVATE_URLS === "true";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private (incl. Docker bridge networks)
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local (incl. fd00:ec2::254 AWS metadata)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["100::", 64], // discard
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** IPv4 embedded in an IPv6 address (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d NAT64), if any. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** True for loopback, private, link-local, metadata, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const v = isIP(addr);
  if (v === 4) return blocked.check(addr, "ipv4");
  if (v === 6) {
    const v4 = embeddedV4(addr);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(addr, "ipv6");
  }
  return true; // not an IP at all: treat as unsafe
}

function isLoopbackIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "");
  const v = isIP(addr);
  if (v === 4) return loopback.check(addr, "ipv4");
  if (v === 6) {
    const v4 = embeddedV4(addr);
    return v4 ? loopback.check(v4, "ipv4") : loopback.check(addr, "ipv6");
  }
  return false;
}

/** Hostnames that point at the local machine / cloud internals regardless of DNS. */
function isInternalHostname(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata" || host.endsWith(".local");
}

/** Local model servers users explicitly configure as an LLM base URL. */
const LLM_LOCAL_HOSTS = new Set(["localhost", "host.docker.internal"]);

type Lookup = (host: string) => Promise<string[]>;

const defaultLookup: Lookup = async (host) => {
  const res = await Promise.race([
    lookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), 3_000).unref?.()),
  ]);
  return res.map((r) => r.address);
};

let lookupImpl: Lookup = defaultLookup;
/** Tests: replace DNS resolution. Pass nothing to restore the real resolver. */
export function setLookupForTests(fn?: Lookup) {
  lookupImpl = fn ?? defaultLookup;
}

/**
 * Throws BlockedUrlError unless `raw` is an http(s) URL whose host is allowed by `policy`.
 * Returns the parsed URL.
 */
export async function assertSafeUrl(raw: string, policy: UrlPolicy = "public"): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("URL must start with http:// or https://");
  if (url.username || url.password) throw new BlockedUrlError("URL must not contain a username or password");
  await assertSafeHost(url.hostname, policy);
  return url;
}

/** Host-only variant (e.g. SMTP servers). */
export async function assertSafeHost(hostname: string, policy: UrlPolicy = "public"): Promise<void> {
  if (allowPrivateUrls()) return;
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host) throw new BlockedUrlError("URL has no host");
  const llmLocal = policy === "llm";
  if (llmLocal && LLM_LOCAL_HOSTS.has(host)) return;
  const deny = () =>
    new BlockedUrlError(
      llmLocal
        ? "That address is on a private network. Use localhost or host.docker.internal for a local model, or set ALLOW_PRIVATE_URLS=true."
        : "That address is on a private or internal network, which is blocked. Set ALLOW_PRIVATE_URLS=true on the server to allow it.",
    );
  if (isIP(host)) {
    if (llmLocal && isLoopbackIp(host)) return;
    if (isPrivateIp(host)) throw deny();
    return;
  }
  if (isInternalHostname(host)) throw deny();
  let addresses: string[];
  try {
    addresses = await lookupImpl(host);
  } catch {
    // Unresolvable here means fetch can't connect either (same resolver); let it fail there.
    return;
  }
  for (const a of addresses) {
    if (llmLocal && isLoopbackIp(a)) continue;
    if (isPrivateIp(a)) throw deny();
  }
}

/** Friendly validation for settings forms: an error message, or null when the URL is allowed. */
export async function checkOutboundUrl(raw: string, policy: UrlPolicy = "public"): Promise<string | null> {
  try {
    await assertSafeUrl(raw, policy);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "URL is not allowed";
  }
}

const MAX_REDIRECTS = 3;

/**
 * fetch() for user-supplied URLs: checks every hop against `policy`. GET/HEAD redirects are
 * followed (re-checked, at most 3); other methods get the 3xx response back unfollowed.
 */
export async function safeFetch(input: string | URL, init: RequestInit = {}, policy: UrlPolicy = "public"): Promise<Response> {
  let url = String(input);
  const method = (init.method ?? "GET").toUpperCase();
  for (let hop = 0; ; hop++) {
    await assertSafeUrl(url, policy);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location || (method !== "GET" && method !== "HEAD")) return res;
    if (hop >= MAX_REDIRECTS) throw new BlockedUrlError("Too many redirects");
    url = new URL(location, url).toString();
  }
}

/** A fetch implementation (for SDKs that accept one) that applies `safeFetch` to every call. */
export function guardedFetch(policy: UrlPolicy): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      await assertSafeUrl(input.url, policy);
      return fetch(input, { ...init, redirect: "manual" });
    }
    return safeFetch(input, init, policy);
  }) as typeof fetch;
}
