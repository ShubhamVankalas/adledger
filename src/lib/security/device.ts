import { truncateIp } from "../tracking/collect";

// Request context for sessions and the audit log: a truncated IP (last IPv4 octet / IPv6 host bits
// dropped) and a short user agent. Enough to recognise "a new device", not enough to track anyone.

export { truncateIp };

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
