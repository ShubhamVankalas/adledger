import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFacts } from "@/lib/ai/facts";
import { unverifiedNumbers } from "@/lib/ai/numbers";
import { generateReport, templateReport } from "@/lib/ai/report";
import { rows, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { buildMcpHandler, fuzzyScore, MCP_TOOL_NAMES } from "@/lib/mcp";
import { saveConnection, type Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

let db: DB;
let ws: Workspace;

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
});

describe("AI facts + number check", () => {
  it("flags a fabricated figure and accepts real ones", async () => {
    const { facts } = await buildFacts(db, ws, { end: "2026-09-01", days: 30 });
    const real = `Spend was ${facts.totals.spend} and ROAS ${facts.totals.roas}. The top campaign was ${facts.topCampaigns[0].name}.`;
    expect(unverifiedNumbers(real, facts)).toEqual([]);
    const fake = `${real} Revenue jumped to $987,654.32 and CPL fell 37.9%.`;
    const bad = unverifiedNumbers(fake, facts);
    expect(bad).toContain("987,654.32");
    expect(bad).toContain("37.9");
  });

  it("template report only uses numbers from the facts pack", async () => {
    const { facts } = await buildFacts(db, ws, { end: "2026-09-01", days: 30 });
    const md = templateReport(facts);
    expect(md).toContain("## Summary");
    expect(unverifiedNumbers(md, facts)).toEqual([]);
    // Reads like an analyst wrote it, not a debug dump.
    expect(md).toContain("**Aug 3 – Sep 1, 2026:** you spent");
    expect(md).toContain("the previous 30 days");
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(md).not.toMatch(/\((meta|google|linkedin|tiktok|microsoft)\)/);
    expect(md).toMatch(/\((Meta|Google|LinkedIn|TikTok|Microsoft)\)/);
    expect(md).not.toMatch(/0\.00x|\$0\.00|\b1 leads\b|changed -/);
    expect(md).not.toMatch(/\$\d{1,3}(,\d{3})+\.\d{2}/); // no cents on large amounts
  });

  it("facts use display names and readable figures", async () => {
    const { facts } = await buildFacts(db, ws, { end: "2026-09-01", days: 7 });
    expect(facts.period).toMatchObject({ start: "2026-08-26", end: "2026-09-01", days: 7, label: "Aug 26 – Sep 1, 2026" });
    expect(facts.attributionModelLabel).toBe("Linear");
    for (const c of [...facts.topCampaigns, ...facts.wastedSpend]) expect(c.platform).toMatch(/^[A-Z]/);
    for (const c of facts.channelMix) expect(c.channel).not.toContain("_");
    expect(facts.changeVsPreviousPeriod.spend).toMatch(/^([+−]\d+\.\d%|0%|new)$/);
  });

  it("generates and stores a report without an LLM configured", async () => {
    const { report } = await generateReport(db, ws, { end: "2026-09-01" });
    expect(report.modelName).toBe("template");
    expect(report.contentMd.length).toBeGreaterThan(100);
  });
});

async function callTool(ws: Workspace, name: string, args: Record<string, unknown> = {}) {
  const handler = buildMcpHandler(ws);
  const init = await handler(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const text = await init.text();
  // Responses may be JSON or a single SSE "data:" frame.
  const json = text.trim().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return json;
}

async function listTools(ws: Workspace) {
  const res = await buildMcpHandler(ws)(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  const text = await res.text();
  return text.trim().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
}

describe("MCP server", () => {
  it("lists exactly the documented tools, all annotated read-only", async () => {
    const r = await listTools(ws);
    const tools = r.result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
  });

  it("no tool modifies data", async () => {
    const snapshot = async () =>
      rows<{ t: string; n: string }>(
        await db.execute(sql`select 'contacts' t, count(*) n from contacts union all select 'credits', count(*) from attribution_credits
          union all select 'revenue', count(*) from revenue_events union all select 'reports', count(*) from ai_reports
          union all select 'insights', count(*) from ad_insights_daily union all select 'runs', count(*) from sync_runs
          union all select 'campaigns', count(*) from campaigns union all select 'events', count(*) from events
          union all select 'connections', count(*) from connections
          union all select 'last_synced', coalesce(extract(epoch from max(last_synced_at)), 0)::bigint from connections`),
      ).sort((a, b) => a.t.localeCompare(b.t));
    const before = await snapshot();
    const [contact] = rows<{ id: string }>(await db.execute(sql`select id from contacts where lifecycle = 'customer' limit 1`));
    const calls: [string, Record<string, unknown>][] = [
      ["get_overview", {}],
      ["get_performance", { level: "ad" }],
      ["find_wasted_spend", {}],
      ["compare_periods", {}],
      ["list_contacts", { lifecycle: "customer" }],
      ["get_contact_journey", { contactId: contact.id }],
      ["get_latest_insights", {}],
      ["get_sync_status", {}],
      ["get_platform_breakdown", {}],
      ["list_integrations", {}],
      ["get_timeseries", { platform: "meta" }],
      ["search_campaigns", { query: "retargeting" }],
    ];
    // Every registered tool must be exercised here.
    expect(calls.map(([n]) => n).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const [name, args] of calls) {
      const r = await callTool(ws, name, args);
      expect(r.error, name).toBeUndefined();
      expect(r.result.isError, name).not.toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("outputs include date range, currency and model; emails are masked", async () => {
    const o = await callTool(ws, "get_overview", { start: "2026-08-01", end: "2026-09-01" });
    const text = o.result.content[0].text as string;
    expect(text).toContain("2026-08-01 → 2026-09-01");
    expect(text).toContain("currency USD");
    expect(text).toContain("attribution model linear");
    const list = await callTool(ws, "list_contacts", { limit: 5 });
    expect(list.result.content[0].text).toMatch(/•/);
    expect(list.result.content[0].text).not.toMatch(/[a-z]+\.[a-z]+\d+@example/);
  });

  it("get_platform_breakdown returns one row per ad platform with totals", async () => {
    const r = await callTool(ws, "get_platform_breakdown", { start: "2026-08-01", end: "2026-09-01", model: "first_touch" });
    const text = r.result.content[0].text as string;
    expect(text).toContain("2026-08-01 → 2026-09-01");
    expect(text).toContain("currency USD");
    expect(text).toContain("attribution model first_touch");
    expect(text).toMatch(/\| meta \| \$[\d,.]+ \|/);
    expect(text).toMatch(/\| google \| \$[\d,.]+ \|/);
    expect(text).toMatch(/\| Total \| \$[\d,.]+ \| \$[\d,.]+ \| [\d.]+x \|/);
  });

  it("get_timeseries returns one line per day", async () => {
    const r = await callTool(ws, "get_timeseries", { start: "2026-08-26", end: "2026-09-01" });
    const text = r.result.content[0].text as string;
    expect(text).toContain("attribution model linear");
    expect(text).toContain("Totals: spend $");
    expect(text.split("\n").filter((l) => /^\| 2026-\d\d-\d\d \|/.test(l))).toHaveLength(7);
    expect(text).not.toContain("for all sources");
    const meta = await callTool(ws, "get_timeseries", { start: "2026-08-26", end: "2026-09-01", platform: "meta" });
    expect(meta.result.content[0].text).toContain("Spend and Attributed are for meta only; Revenue and Leads are for all sources.");
    const bad = await callTool(ws, "get_timeseries", { start: "2026-09-01", end: "2026-08-01" });
    expect(bad.result.isError).toBe(true);
    const impossible = await callTool(ws, "get_timeseries", { start: "2026-02-31", end: "2026-03-02" });
    expect(impossible.result.isError).toBe(true);
    const tooLong = await callTool(ws, "get_timeseries", { start: "2024-01-01", end: "2026-09-01" });
    expect(tooLong.result.isError).toBe(true);
  });

  it("search_campaigns finds campaigns by fuzzy name with ids and metrics", async () => {
    const r = await callTool(ws, "search_campaigns", { query: "retargetng site", start: "2026-08-01", end: "2026-09-01" });
    const text = r.result.content[0].text as string;
    expect(text).toContain("currency USD");
    expect(text).toMatch(/^- [0-9a-f-]{36} · Retargeting – Site Visitors 30d \(meta/m);
    expect(text).toMatch(/spend \$[\d,.]+ · revenue \$[\d,.]+ · ROAS/);
    const google = await callTool(ws, "search_campaigns", { query: "search", platform: "google" });
    const lines = (google.result.content[0].text as string).split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l).toContain("(google");
    const none = await callTool(ws, "search_campaigns", { query: "zzzz nothing like this" });
    expect(none.result.content[0].text).toContain("0 campaign(s)");
  });

  it("list_integrations shows connections and sync health but never secrets", async () => {
    await saveConnection(ws.id, "notify_discord", { secrets: { webhookUrl: "https://discord.com/api/webhooks/1/SUPERSECRETVALUE" } }, db);
    const r = await callTool(ws, "list_integrations");
    const text = r.result.content[0].text as string;
    expect(text).toMatch(/Meta Ads \(meta, ads\) · mock · health (ok|stale)/);
    expect(text).toContain("(stripe, revenue)");
    expect(text).toMatch(/Discord \(notify_discord, notifications\) · live · health active/);
    expect(text).toContain("Website pixel · 1 site(s)");
    expect(text).not.toContain("SUPERSECRETVALUE");
    expect(text).not.toContain("demoAnchor");
  });

  it("masks tokens and emails in sync errors shown to agents", async () => {
    const leaky = "GET https://graph.facebook.com/v21.0/act_1/insights?fields=spend&access_token=EAAGleaky123 failed for ops@acme.io (Authorization: Bearer sk_live_abc)";
    await db.execute(sql`update connections set last_error = ${leaky} where workspace_id = ${ws.id} and provider = 'stripe'`);
    try {
      for (const tool of ["list_integrations", "get_sync_status"]) {
        const out = (await callTool(ws, tool)).result.content[0].text as string;
        expect(out, tool).toContain("access_token=***");
        expect(out, tool).not.toContain("EAAGleaky123");
        expect(out, tool).not.toContain("ops@acme.io");
        expect(out, tool).not.toContain("sk_live_abc");
      }
      expect((await callTool(ws, "list_integrations")).result.content[0].text).toMatch(/\(stripe, revenue\) · \w+ · health error/);
    } finally {
      await db.execute(sql`update connections set last_error = null where workspace_id = ${ws.id} and provider = 'stripe'`);
    }
  });
});

describe("fuzzyScore", () => {
  it("ranks exact > prefix > substring > word matches > typos, and rejects non-matches", () => {
    const name = "Retargeting – Summer Sale 2026";
    expect(fuzzyScore("retargeting – summer sale 2026", name)).toBe(100);
    expect(fuzzyScore("Retargeting summer", name)).toBe(90);
    expect(fuzzyScore("summer sale", name)).toBe(80);
    const words = fuzzyScore("sale retargeting", name);
    const prefix = fuzzyScore("sale retarget", name);
    const typo = fuzzyScore("sale retargetng", name);
    expect(words).toBeLessThan(80);
    expect(prefix).toBeLessThan(words);
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeLessThan(prefix);
    expect(fuzzyScore("winter", name)).toBe(0);
    expect(fuzzyScore("", name)).toBe(0);
  });

  it("does not match every name on one or two letters", () => {
    expect(fuzzyScore("a", "Brand Awareness – Video Views")).toBeGreaterThan(0); // word start
    expect(fuzzyScore("a", "Search – Brand")).toBe(0);
    expect(fuzzyScore("ar", "Search – Brand")).toBe(0);
    expect(fuzzyScore("arch", "Search – Brand")).toBe(80);
  });

  it("works for non-Latin campaign names and ignores accents", () => {
    expect(fuzzyScore("दिवाली", "दिवाली सेल 2026")).toBe(90);
    expect(fuzzyScore("сейл", "Осенний Сейл")).toBe(80);
    expect(fuzzyScore("xyz", "दिवाली सेल")).toBe(0);
    expect(fuzzyScore("cafe", "Café Crème – Retargeting")).toBe(90);
  });
});
