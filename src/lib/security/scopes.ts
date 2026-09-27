import type { ApiScope } from "../db/schema";

// API key scopes. A key carries a list; every REST/MCP route names the scope it needs.
// New keys default to read-only reports. Keys created before scopes existed were migrated to
// every scope except contacts:pii (see drizzle/0005_trust_core.sql).

export type { ApiScope };

export const SCOPES: { scope: ApiScope; label: string; description: string; write?: boolean }[] = [
  { scope: "reports:read", label: "Reports", description: "Overview, performance, channels, LTV and the other report endpoints." },
  { scope: "mcp", label: "MCP server", description: "Connect AI agents (Claude, Cursor). Read-only; contact emails are masked." },
  { scope: "contacts:read", label: "Contacts", description: "Contact lists, journeys and the contacts CSV, with emails masked." },
  { scope: "contacts:pii", label: "Contact emails", description: "Unmasked emails in contact responses and exports, plus single-contact data exports." },
  { scope: "ingest:write", label: "Write data", description: "Push spend and conversions, trigger syncs and erase contacts.", write: true },
];

export const ALL_SCOPES = SCOPES.map((s) => s.scope);
export const DEFAULT_SCOPES: ApiScope[] = ["reports:read"];

export const SCOPE_PRESETS: { id: "read" | "readwrite" | "custom"; label: string; description: string; scopes: ApiScope[] }[] = [
  { id: "read", label: "Read only", description: "Reports and the MCP server.", scopes: ["reports:read", "mcp"] },
  { id: "readwrite", label: "Read and write", description: "Also push spend and conversions.", scopes: ["reports:read", "mcp", "contacts:read", "ingest:write"] },
];

export const isScope = (v: unknown): v is ApiScope => typeof v === "string" && (ALL_SCOPES as string[]).includes(v);

/** Scopes from a form or query, deduplicated and in canonical order; falls back to the default. */
export function parseScopes(values: unknown[]): ApiScope[] {
  const picked = new Set(values.filter(isScope));
  const scopes = ALL_SCOPES.filter((s) => picked.has(s));
  return scopes.length ? scopes : DEFAULT_SCOPES;
}

export const scopeLabel = (s: string) => SCOPES.find((x) => x.scope === s)?.label ?? s;

/** A short summary for a key row: "Read only", "Read and write" or the scope labels. */
export function describeScopes(scopes: readonly string[]): string {
  const set = new Set(scopes);
  const preset = SCOPE_PRESETS.find((p) => p.scopes.length === set.size && p.scopes.every((s) => set.has(s)));
  if (preset) return preset.label;
  return ALL_SCOPES.filter((s) => set.has(s)).map(scopeLabel).join(", ") || "No access";
}
