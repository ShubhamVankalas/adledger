import { headers } from "next/headers";

/** Public base URL of this install (PUBLIC_URL, or detected from the request). */
export async function publicUrl(): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0];
  return `${proto}://${host}`;
}

/**
 * A same-site path to redirect to after sign-in, or "/". Rejects absolute URLs,
 * protocol-relative `//host` and the `/\host` form browsers also treat as another origin.
 */
export function safeRedirectPath(next: unknown): string {
  const s = typeof next === "string" ? next.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s)) return "/";
  try {
    const u = new URL(s, "http://adledger.invalid");
    return u.origin === "http://adledger.invalid" ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}
