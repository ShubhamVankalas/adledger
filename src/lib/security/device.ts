// Request context for sessions and the audit log: a truncated IP (last IPv4 octet / IPv6 host bits
// dropped) and a short user agent. Enough to recognise "a new device", not enough to track anyone.

/** 203.0.113.42 → 203.0.113.0; 2001:db8:abcd:12::1 → 2001:db8:abcd::; loopback stays as is. */
export function truncateIp(ip: string | null | undefined): string | null {
  const first = ip?.split(",")[0]?.trim().replace(/^\[|\]$/g, "");
  if (!first) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(first)?.[1];
  const v4 = mapped ?? first;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.replace(/\.\d+$/, ".0");
  if (!first.includes(":")) return null;
  if (first === "::1") return "::1";
  const [head, tail = ""] = first.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = first.includes("::") && tail ? tail.split(":") : [];
  const groups = first.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":")}::`;
}

export const MAX_UA_LENGTH = 300;

export function shortUserAgent(ua: string | null | undefined): string | null {
  const v = ua?.trim();
  return v ? v.slice(0, MAX_UA_LENGTH) : null;
}

/** "Chrome on Windows", "Safari on iPhone"… from a user agent string. */
export function describeUserAgent(ua: string | null | undefined): { browser: string; os: string; label: string; mobile: boolean } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : /curl\//i.test(s)
              ? "curl"
              : s
                ? "Browser"
                : "Unknown browser";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "unknown OS";
  return { browser, os, label: `${browser} on ${os}`, mobile: /Mobi|iPhone|Android/.test(s) };
}

/** A stable label for "have we seen this device before?" (browser family + OS, not the version). */
export const deviceKey = (ua: string | null | undefined) => describeUserAgent(ua).label;
