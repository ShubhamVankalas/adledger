// Shared formatting + HTTP helpers for notification channel drivers.
// Message text is "markdown-lite": **bold**, "- " bullets, blank lines between paragraphs.

import type { NotificationMessage } from "../connectors/types";
import { BlockedUrlError, safeFetch } from "../net";

export type Severity = NotificationMessage["severity"];

export const BRAND_COLOR = "#0f9d74";

export const SEVERITY: Record<Severity, { label: string; color: string; emoji: string }> = {
  info: { label: "Info", color: "#2563eb", emoji: "ℹ️" },
  success: { label: "Success", color: "#0f9d74", emoji: "✅" },
  warning: { label: "Warning", color: "#d97706", emoji: "⚠️" },
  critical: { label: "Critical", color: "#dc2626", emoji: "🚨" },
};

export const severityColor = (s: Severity): string => (SEVERITY[s] ?? SEVERITY.info).color;
export const severityEmoji = (s: Severity): string => (SEVERITY[s] ?? SEVERITY.info).emoji;
export const severityLabel = (s: Severity): string => (SEVERITY[s] ?? SEVERITY.info).label;
/** Hex "#rrggbb" → integer (Discord embed colors). */
export const severityColorInt = (s: Severity): number => parseInt(severityColor(s).slice(1), 16);

// ---------------------------------------------------------------- parsing

export type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;

/** Split markdown-lite text into paragraphs and bullet lists. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const raw of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      cur = null;
      continue;
    }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      if (cur?.kind !== "ul") blocks.push((cur = { kind: "ul", items: [] }));
      cur.items.push(item);
    } else {
      if (cur?.kind !== "p") blocks.push((cur = { kind: "p", lines: [] }));
      cur.lines.push(line.trim());
    }
  }
  return blocks;
}

// ---------------------------------------------------------------- HTML

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape, then turn **bold** into <strong>. */
export function inlineHtml(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Markdown-lite → HTML. `styles` lets email inline its CSS on each element. */
export function toHtml(text: string, styles: { p?: string; ul?: string; li?: string } = {}): string {
  const attr = (css?: string) => (css ? ` style="${css}"` : "");
  return parseBlocks(text)
    .map((b) =>
      b.kind === "p"
        ? `<p${attr(styles.p)}>${b.lines.map(inlineHtml).join("<br>")}</p>`
        : `<ul${attr(styles.ul)}>${b.items.map((i) => `<li${attr(styles.li)}>${inlineHtml(i)}</li>`).join("")}</ul>`,
    )
    .join("\n");
}

// ---------------------------------------------------------------- Slack / plain

/** Escape the three characters Slack treats as control characters. */
export function escapeSlack(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Markdown-lite → Slack mrkdwn (**bold** → *bold*, bullets → •). */
export function toSlackMrkdwn(text: string): string {
  return parseBlocks(text)
    .map((b) => {
      const conv = (s: string) => escapeSlack(s).replace(/\*\*(.+?)\*\*/g, "*$1*");
      return b.kind === "p" ? b.lines.map(conv).join("\n") : b.items.map((i) => `• ${conv(i)}`).join("\n");
    })
    .join("\n\n");
}

/** Markdown-lite → plain text (bold markers stripped, bullets kept as "- "). */
export function toPlain(text: string): string {
  const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");
  return parseBlocks(text)
    .map((b) => (b.kind === "p" ? b.lines.map(strip).join("\n") : b.items.map((i) => `- ${strip(i)}`).join("\n")))
    .join("\n\n");
}

// ---------------------------------------------------------------- misc

/** Only http(s) links are rendered as buttons/links (blocks javascript: etc.). */
export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return max <= 1 ? s.slice(0, max) : `${s.slice(0, max - 1)}…`;
}

export const splitList = (s: string | undefined): string[] =>
  (s ?? "")
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Replace every occurrence of any secret with "***" (for error messages). */
export function redact(s: string, secrets: (string | undefined)[]): string {
  let out = s;
  for (const sec of secrets) if (sec && sec.length >= 4) out = out.split(sec).join("***");
  return out;
}

export const HTTP_TIMEOUT_MS = 15_000;

/**
 * POST with a 15s timeout; throws `<channel> returned HTTP <status>: <snippet>` on non-2xx.
 * Error messages never contain the URL or any of `secrets`.
 */
export async function postOrThrow(
  channel: string,
  url: string,
  init: { body: string; headers: Record<string, string> },
  secrets: (string | undefined)[] = [],
): Promise<Response> {
  let res: Response;
  try {
    // User-supplied URL: private/metadata addresses are blocked and redirects are not followed.
    res = await safeFetch(url, {
      method: "POST",
      headers: { "User-Agent": "AdLedger-Notify/1.0", ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof BlockedUrlError) throw new Error(`${channel} request blocked: ${err.message}`);
    const e = err as Error;
    const why = e?.name === "TimeoutError" ? `timed out after ${HTTP_TIMEOUT_MS / 1000}s` : (e?.message ?? String(err));
    throw new Error(`${channel} request failed: ${redact(why, [url, ...secrets])}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const snippet = truncate(redact(body.replace(/\s+/g, " ").trim(), [url, ...secrets]), 200);
    throw new Error(`${channel} returned HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`);
  }
  return res;
}

export function requireField(value: string | undefined, what: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new Error(`${what} is not set`);
  return v;
}
