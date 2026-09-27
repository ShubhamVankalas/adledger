// Client-safe CRM types and the Contacts table's URL state (filters, sort, columns, views).
// No server imports: used by the server page, reports-crm.ts (SQL) and the client table alike.
// The state is the URL, so any table state is a shareable link and can be saved as a view.

export const CONTACT_SORTS = ["first_seen", "last_activity", "revenue", "orders", "touches", "engagement", "name"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export const CONTACT_COLUMNS = [
  "lifecycle",
  "tags",
  "first_touch",
  "last_touch",
  "touches",
  "orders",
  "revenue",
  "engagement",
  "days_to_convert",
  "last_activity",
  "first_seen",
  "owner",
] as const;
export type ContactColumn = (typeof CONTACT_COLUMNS)[number];
export const DEFAULT_COLUMNS: ContactColumn[] = ["lifecycle", "tags", "first_touch", "revenue", "last_activity", "owner"];

export const COLUMN_LABELS: Record<ContactColumn, string> = {
  lifecycle: "Status",
  tags: "Tags",
  first_touch: "First touch",
  last_touch: "Last touch",
  touches: "Touches",
  orders: "Orders",
  revenue: "Revenue",
  engagement: "Engagement",
  days_to_convert: "Days to convert",
  last_activity: "Last activity",
  first_seen: "Added",
  owner: "Owner",
};
/** The sort a column header toggles, when it has one. */
export const COLUMN_SORT: Partial<Record<ContactColumn, ContactSort>> = {
  revenue: "revenue",
  orders: "orders",
  touches: "touches",
  engagement: "engagement",
  last_activity: "last_activity",
  first_seen: "first_seen",
};
export const NUMERIC_COLUMNS = new Set<ContactColumn>(["touches", "orders", "revenue", "engagement", "days_to_convert"]);

export const ADDED_RANGES = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 } as const;
export type AddedRange = keyof typeof ADDED_RANGES;
export const ADDED_LABELS: Record<AddedRange, string> = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  "365d": "last 12 months",
};

export type Lifecycle = "lead" | "customer";

/** Built-in views. Their filters are implied by the view (not written into the URL). */
export const STARTER_VIEWS = [
  { id: "all", label: "All" },
  { id: "customers", label: "Customers" },
  { id: "leads", label: "Open leads" },
  { id: "high", label: "High value" },
] as const;
export type StarterViewId = (typeof STARTER_VIEWS)[number]["id"];
export const isStarterView = (v: string): v is StarterViewId => STARTER_VIEWS.some((s) => s.id === v);

export type ContactQuery = {
  /** Starter view id or a saved view's uuid. */
  view: string;
  q: string;
  lc: Lifecycle | null;
  platform: string[];
  campaign: string | null;
  /** Revenue range in major units of the reporting currency, as typed ("100", "99.50"). */
  revMin: string | null;
  revMax: string | null;
  tag: string[];
  /** "me", "none" or a user id. */
  owner: string | null;
  added: AddedRange | null;
  sort: ContactSort;
  dir: "asc" | "desc";
  group: "lifecycle" | null;
  cols: ContactColumn[];
  density: "compact" | "comfortable";
  /** Keyset cursor: "a.<token>" (after) or "b.<token>" (before). */
  cursor: string | null;
};

export const DEFAULT_QUERY: ContactQuery = {
  view: "all",
  q: "",
  lc: null,
  platform: [],
  campaign: null,
  revMin: null,
  revMax: null,
  tag: [],
  owner: null,
  added: null,
  sort: "first_seen",
  dir: "desc",
  group: null,
  cols: DEFAULT_COLUMNS,
  density: "compact",
  cursor: null,
};

/** URL keys that narrow the rows (chips). Sort/columns/density/group are presentation. */
export const FILTER_KEYS = ["q", "lc", "platform", "campaign", "revMin", "revMax", "tag", "owner", "added"] as const;
/** Keys a saved view stores. */
export const VIEW_KEYS = [...FILTER_KEYS, "sort", "dir", "group", "cols", "density"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^\d{1,12}(\.\d{1,3})?$/;
const SLUG = /^[a-z0-9_]{1,32}$/;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
function getter(sp: Params) {
  return (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
}
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
}

/** Parse (and sanitize) the table state from search params. Unknown values fall back to defaults. */
export function parseContactQuery(sp: Params): ContactQuery {
  const get = getter(sp);
  const view = get("view") ?? "all";
  // `lifecycle` is the pre-CRM parameter name (old links and bookmarks).
  const lc = get("lc") ?? get("lifecycle");
  const sort = get("sort");
  const cols = list(get("cols")).filter((c): c is ContactColumn => (CONTACT_COLUMNS as readonly string[]).includes(c));
  const owner = get("owner");
  const added = get("added");
  const campaign = get("campaign");
  const revMin = get("revMin")?.trim();
  const revMax = get("revMax")?.trim();
  const cursor = get("cursor");
  return {
    view: isStarterView(view) || UUID.test(view) ? view : "all",
    q: (get("q") ?? "").trim().slice(0, 200),
    lc: lc === "lead" || lc === "customer" ? lc : null,
    platform: [...new Set(list(get("platform")).filter((p) => SLUG.test(p)))].slice(0, 12),
    campaign: campaign && UUID.test(campaign) ? campaign : null,
    revMin: revMin && DECIMAL.test(revMin) ? revMin : null,
    revMax: revMax && DECIMAL.test(revMax) ? revMax : null,
    tag: [...new Set(list(get("tag")).map(normalizeTag).filter(Boolean))].slice(0, 12),
    owner: owner === "me" || owner === "none" || (owner && UUID.test(owner)) ? owner : null,
    added: added && added in ADDED_RANGES ? (added as AddedRange) : null,
    sort: (CONTACT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as ContactSort) : DEFAULT_QUERY.sort,
    dir: get("dir") === "asc" ? "asc" : get("dir") === "desc" ? "desc" : sort === "name" ? "asc" : "desc",
    group: get("group") === "lifecycle" ? "lifecycle" : null,
    cols: cols.length ? [...new Set(cols)] : DEFAULT_COLUMNS,
    density: get("density") === "comfortable" ? "comfortable" : "compact",
    cursor: cursor && /^[ab]\.[A-Za-z0-9_-]{1,400}$/.test(cursor) ? cursor : null,
  };
}

const defaultDir = (sort: ContactSort) => (sort === "name" ? "asc" : "desc");

/** Serialize to a params object, leaving out defaults so links stay short. */
export function contactQueryParams(q: ContactQuery, keys: readonly string[] = [...VIEW_KEYS, "view", "cursor"]): Record<string, string> {
  const out: Record<string, string> = {};
  const want = new Set(keys);
  const put = (k: string, v: string | null | undefined) => {
    if (want.has(k) && v) out[k] = v;
  };
  put("view", q.view !== "all" ? q.view : null);
  put("q", q.q);
  put("lc", q.lc);
  put("platform", q.platform.join(","));
  put("campaign", q.campaign);
  put("revMin", q.revMin);
  put("revMax", q.revMax);
  put("tag", q.tag.join(","));
  put("owner", q.owner);
  put("added", q.added);
  put("sort", q.sort !== DEFAULT_QUERY.sort ? q.sort : null);
  put("dir", q.dir !== defaultDir(q.sort) ? q.dir : null);
  put("group", q.group);
  put("cols", q.cols.join(",") !== DEFAULT_COLUMNS.join(",") ? q.cols.join(",") : null);
  put("density", q.density !== "compact" ? q.density : null);
  put("cursor", q.cursor);
  return out;
}

export function contactsHref(q: ContactQuery, patch: Partial<ContactQuery> = {}): string {
  const next = { ...q, cursor: null, ...patch };
  const s = new URLSearchParams(contactQueryParams(next)).toString();
  return s ? `/contacts?${s}` : "/contacts";
}

/** Stable signature of a view's stored keys, to tell whether the current table differs from it. */
export function viewSignature(params: Record<string, string>): string {
  return VIEW_KEYS.map((k) => `${k}=${params[k] ?? ""}`).join("&");
}

export const hasFilters = (q: ContactQuery) =>
  Boolean(q.q || q.lc || q.platform.length || q.campaign || q.revMin || q.revMax || q.tag.length || q.owner || q.added);

// ---------------------------------------------------------------- shared row types

export type ContactListRow = {
  id: string;
  name: string | null;
  /** Already passed through displayEmail() for the viewer. */
  email: string | null;
  lifecycle: Lifecycle;
  firstSeenAt: string;
  ownerUserId: string | null;
  tags: string[];
  revenueMinor: number;
  orders: number;
  touches: number;
  engagement: number;
  daysToConvert: number | null;
  lastActivityAt: string | null;
  firstTouch: { platform: string | null; channel: string | null; campaign: string | null } | null;
  lastTouch: { platform: string | null; channel: string | null; campaign: string | null } | null;
};

export type ContactTotals = {
  count: number;
  customers: number;
  revenueMinor: number;
  /** Net revenue per paying contact, or null without customers. */
  avgLtvMinor: number | null;
  medianDaysToConvert: number | null;
};

export type ContactGroupTotals = Record<Lifecycle, ContactTotals>;

/** A personal saved view: its name and the table URL params it restores. */
export type ContactView = { id: string; name: string; filters: Record<string, string> };

export type FilterOptions = {
  platforms: { id: string; count: number }[];
  campaigns: { id: string; name: string; platform: string; count: number }[];
  tags: { tag: string; count: number }[];
};

export type CrmMember = { id: string; name: string | null; email: string; role: string; canEdit: boolean };

/** What the viewer may do on CRM surfaces (computed on the server from their role). */
export type CrmAbilities = {
  /** Tags, owner, status, name, tasks and notes (contacts.edit). */
  edit: boolean;
  /** See notes and tasks (contacts.notes). */
  notes: boolean;
  /** Edit or delete anyone's note, not just their own (owner, admin). */
  moderate: boolean;
  /** Download contact CSVs. */
  export: boolean;
  /** Erase contacts (workspace.data). */
  delete: boolean;
  /** Reveal masked contact emails on screen, audited (contacts.pii). */
  pii: boolean;
};

export type TaskRow = {
  id: string;
  title: string;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  assigneeUserId: string | null;
  contact: { id: string; name: string | null; email: string | null } | null;
};

export type NoteRow = {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  authorUserId: string | null;
  authorName: string | null;
};

export type TimelineEntry =
  | {
      kind: "touchpoint";
      at: string;
      channel: string;
      source: string | null;
      medium: string | null;
      campaign: string | null;
      adGroup: string | null;
      ad: string | null;
      platform: string | null;
      landingUrl: string | null;
      referrer: string | null;
      device: number;
    }
  | { kind: "lead"; at: string; source: string; formName: string | null }
  | { kind: "payment" | "refund"; at: string; amountMinor: number; currency: string }
  | { kind: "page_view"; at: string; path: string; host: string | null }
  | { kind: "event"; at: string; name: string }
  | { kind: "note"; at: string; note: NoteRow }
  | { kind: "task"; at: string; task: TaskRow };

export type TimelineKind = "ad_click" | "page_view" | "form" | "payment" | "refund" | "note" | "task";

export type ContactRecord = {
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    lifecycle: Lifecycle;
    firstSeenAt: string;
    ownerUserId: string | null;
    devices: number;
  };
  tags: string[];
  highlights: {
    revenueMinor: number;
    orders: number;
    refundsMinor: number;
    touches: number;
    daysToConvert: number | null;
    lastSeenAt: string | null;
    engagement: number | null;
    firstTouch: { platform: string | null; channel: string; campaign: string | null; landingPath: string | null } | null;
    firstLeadAt: string | null;
    convertedAt: string | null;
  };
  timeline: TimelineEntry[];
  /** True when page views were capped (only the most recent are shown). */
  pageViewsCapped: boolean;
  notes: NoteRow[] | null;
  tasks: TaskRow[] | null;
  credits: { model: string; label: string; revenueMinor: number }[];
  currency: string;
  timezone: string;
};
