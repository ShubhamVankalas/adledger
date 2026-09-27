import { sql, type SQL } from "drizzle-orm";
import { EMAIL_RE, hashEmail } from "./crypto";
import { rows, type DB } from "./db";
import { maskEmail } from "./reports";
import type { Workspace } from "./settings";

// Workspace search for the ⌘K palette and POST /api/v1/search: contacts by name or email, and
// campaigns, ad sets and ads by name. Every query is pinned to one workspace.
//
// Matching is a case-insensitive substring (strpos on lower()), which needs no LIKE escaping and
// works the same on PostgreSQL and the embedded PGlite. There is no trigram index: pg_trgm isn't
// loaded in PGlite and CREATE EXTENSION can need privileges a managed database won't grant. Each
// query filters on workspace_id first and stops at a small LIMIT, and a full email address is
// looked up through the (workspace_id, email_hash) unique index.

export const SEARCH_KINDS = ["contact", "campaign", "ad_group", "ad"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchResult = {
  kind: SearchKind;
  id: string;
  /** Contact name (or email), or the campaign / ad set / ad name. */
  title: string;
  /** Contact email when a name is shown; the parent campaign / ad set for ad sets and ads. */
  subtitle: string | null;
  /** Ad platform for campaigns, ad sets and ads. */
  platform: string | null;
  /** "lead" / "customer" for contacts; the platform's delivery status for ads. */
  status: string | null;
  /** Dashboard path that opens the result. */
  url: string;
};

export const SEARCH_QUERY_MAX = 100;

export type SearchOptions = {
  kinds?: readonly SearchKind[];
  /** Results per kind (1–10, default 5). */
  limit?: number;
  /** Mask contact emails (a•••@example.com), e.g. for the client role. */
  maskEmails?: boolean;
};

type Row = Record<string, string | null>;

/** Ranking shared by every kind: exact name, then prefix, then shorter names. */
function rank(col: SQL, q: string): SQL {
  return sql`(lower(${col}) = ${q}) desc, (left(lower(${col}), ${q.length}) = ${q}) desc, length(${col}), ${col}`;
}

export async function searchWorkspace(db: DB, ws: Workspace, query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase().slice(0, SEARCH_QUERY_MAX);
  if (!q) return [];
  const limit = Math.min(10, Math.max(1, Math.trunc(opts.limit ?? 5)));
  const kinds = new Set(opts.kinds?.length ? opts.kinds : SEARCH_KINDS);

  const tasks: Promise<SearchResult[]>[] = [];
  if (kinds.has("contact")) tasks.push(searchContacts(db, ws, q, limit, opts.maskEmails ?? false));
  if (kinds.has("campaign")) tasks.push(searchCampaigns(db, ws, q, limit));
  if (kinds.has("ad_group")) tasks.push(searchAdGroups(db, ws, q, limit));
  if (kinds.has("ad")) tasks.push(searchAds(db, ws, q, limit));
  return (await Promise.all(tasks)).flat();
}

async function searchContacts(db: DB, ws: Workspace, q: string, limit: number, mask: boolean): Promise<SearchResult[]> {
  const hash = EMAIL_RE.test(q) ? hashEmail(q) : null;
  const exact = hash ? sql`coalesce(c.email_hash = ${hash}, false)` : null;
  const name = sql`coalesce(c.name, '')`;
  const email = sql`coalesce(c.email, '')`;
  const found = rows<Row>(
    await db.execute(sql`
      select c.id, c.name, c.email, c.lifecycle
      from contacts c
      where c.workspace_id = ${ws.id}
        and (${exact ?? sql`false`} or strpos(lower(${name}), ${q}) > 0 or strpos(lower(${email}), ${q}) > 0)
      order by ${exact ? sql`${exact} desc,` : sql``}
        (lower(${name}) = ${q}) desc,
        (left(lower(${name}), ${q.length}) = ${q}) desc,
        (left(lower(${email}), ${q.length}) = ${q}) desc,
        c.first_seen_at desc, c.id
      limit ${limit}`),
  );
  return found.map((r) => {
    const shownEmail = mask ? maskEmail(r.email) : r.email;
    const title = r.name?.trim() || shownEmail || "Unnamed contact";
    return {
      kind: "contact" as const,
      id: r.id!,
      title,
      subtitle: r.name?.trim() ? shownEmail : null,
      platform: null,
      status: r.lifecycle,
      url: `/contacts/${r.id}`,
    };
  });
}

async function searchCampaigns(db: DB, ws: Workspace, q: string, limit: number): Promise<SearchResult[]> {
  const found = rows<Row>(
    await db.execute(sql`
      select c.id, c.name, c.platform, c.status
      from campaigns c
      where c.workspace_id = ${ws.id} and strpos(lower(c.name), ${q}) > 0
      order by ${rank(sql`c.name`, q)}
      limit ${limit}`),
  );
  return found.map((r) => ({
    kind: "campaign" as const,
    id: r.id!,
    title: r.name!,
    subtitle: null,
    platform: r.platform,
    status: r.status,
    url: `/performance?level=ad_group&parent=${r.id}`,
  }));
}

async function searchAdGroups(db: DB, ws: Workspace, q: string, limit: number): Promise<SearchResult[]> {
  const found = rows<Row>(
    await db.execute(sql`
      select g.id, g.name, g.platform, g.status, c.name campaign_name
      from ad_groups g
      join campaigns c on c.id = g.campaign_id and c.workspace_id = g.workspace_id
      where g.workspace_id = ${ws.id} and strpos(lower(g.name), ${q}) > 0
      order by ${rank(sql`g.name`, q)}
      limit ${limit}`),
  );
  return found.map((r) => ({
    kind: "ad_group" as const,
    id: r.id!,
    title: r.name!,
    subtitle: r.campaign_name,
    platform: r.platform,
    status: r.status,
    url: `/performance?level=ad&parent=${r.id}`,
  }));
}

async function searchAds(db: DB, ws: Workspace, q: string, limit: number): Promise<SearchResult[]> {
  const found = rows<Row>(
    await db.execute(sql`
      select a.id, a.name, a.platform, a.status, a.ad_group_id, g.name group_name
      from ads a
      join ad_groups g on g.id = a.ad_group_id and g.workspace_id = a.workspace_id
      where a.workspace_id = ${ws.id} and strpos(lower(a.name), ${q}) > 0
      order by ${rank(sql`a.name`, q)}
      limit ${limit}`),
  );
  return found.map((r) => ({
    kind: "ad" as const,
    id: r.id!,
    title: r.name!,
    subtitle: r.group_name,
    platform: r.platform,
    status: r.status,
    url: `/performance?level=ad&parent=${r.ad_group_id}`,
  }));
}
