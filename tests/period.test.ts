import { beforeAll, describe, expect, it } from "vitest";
import { schema, type DB } from "@/lib/db";
import { comparisonParams, resolvePeriodParams, todayIn, toQueryString } from "@/lib/period";
import { addDays, comparisonRange, isIsoDate, parseCompare, presetRange, RANGE_PRESETS, shiftYears } from "@/lib/period-presets";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

describe("date presets", () => {
  const today = "2026-09-27";

  it("resolves calendar presets from the workspace's today", () => {
    expect(presetRange("today", today)).toEqual({ start: today, end: today });
    expect(presetRange("yesterday", today)).toEqual({ start: "2026-09-26", end: "2026-09-26" });
    expect(presetRange("mtd", today)).toEqual({ start: "2026-09-01", end: today });
    expect(presetRange("lastmonth", today)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(presetRange("qtd", today)).toEqual({ start: "2026-07-01", end: today });
    expect(presetRange("ytd", today)).toEqual({ start: "2026-01-01", end: today });
  });

  it("handles month, quarter and year edges", () => {
    expect(presetRange("lastmonth", "2026-01-15")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(presetRange("lastmonth", "2024-03-31")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(presetRange("yesterday", "2026-01-01")).toEqual({ start: "2025-12-31", end: "2025-12-31" });
    expect(presetRange("qtd", "2026-12-31")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(presetRange("qtd", "2026-04-01")).toEqual({ start: "2026-04-01", end: "2026-04-01" });
  });

  it("ends rolling ranges on the data anchor, inclusive", () => {
    expect(presetRange("7d", today)).toEqual({ start: "2026-09-21", end: today });
    expect(presetRange("30d", today, "2026-09-10")).toEqual({ start: "2026-08-12", end: "2026-09-10" });
    expect(presetRange("90d", today)).toEqual({ start: addDays(today, -89), end: today });
    // Calendar presets ignore the anchor.
    expect(presetRange("mtd", today, "2026-08-10")).toEqual({ start: "2026-09-01", end: today });
  });

  it("every preset produces a valid, ordered range", () => {
    for (const { key } of RANGE_PRESETS) {
      const r = presetRange(key, today);
      expect(isIsoDate(r.start) && isIsoDate(r.end), key).toBe(true);
      expect(r.start <= r.end, key).toBe(true);
    }
  });

  it("compares with the previous period, the previous year or nothing", () => {
    expect(comparisonRange("2026-09-01", "2026-09-30", "prev")).toEqual({ start: "2026-08-02", end: "2026-08-31" });
    expect(comparisonRange("2026-09-27", "2026-09-27", "prev")).toEqual({ start: "2026-09-26", end: "2026-09-26" });
    expect(comparisonRange("2026-09-01", "2026-09-30", "year")).toEqual({ start: "2025-09-01", end: "2025-09-30" });
    expect(comparisonRange("2024-02-01", "2024-02-29", "year")).toEqual({ start: "2023-02-01", end: "2023-02-28" });
    expect(comparisonRange("2026-09-01", "2026-09-30", "none")).toBeNull();
    expect(shiftYears("2024-02-29", -1)).toBe("2023-02-28");
  });

  it("validates inputs", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(parseCompare("year")).toBe("year");
    expect(parseCompare("bogus")).toBe("prev");
    expect(parseCompare(undefined)).toBe("prev");
  });
});

describe("toQueryString", () => {
  it("keeps every filter when an old report URL redirects", () => {
    expect(toQueryString({})).toBe("");
    expect(toQueryString({ range: "90d", platform: "meta", empty: undefined })).toBe("?range=90d&platform=meta");
    expect(toQueryString({ tag: ["a", "b"], q: "a&b" })).toBe("?tag=a&tag=b&q=a%26b");
  });
});

describe("resolvePeriodParams", () => {
  let db: DB;
  let ws: Workspace;
  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
  });

  it("defaults to the last 30 days vs the previous period", async () => {
    const p = await resolvePeriodParams(db, ws, {});
    const today = todayIn(ws.timezone);
    expect(p).toMatchObject({ range: "30d", end: today, start: addDays(today, -29), compare: "prev", model: "linear" });
    expect(p.comparison).toEqual({ start: addDays(today, -59), end: addDays(today, -30) });
    expect(comparisonParams(p)).toEqual({ model: "linear", platform: undefined, start: addDays(today, -59), end: addDays(today, -30) });
  });

  it("anchors rolling ranges to the latest day with data", async () => {
    const at = new Date("2026-03-15T12:00:00Z");
    const [v] = await db.insert(schema.visitors).values({ workspaceId: ws.id, anonymousId: "anchor", firstSeenAt: at, lastSeenAt: at }).returning();
    await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: v.id, type: "page_view", url: "https://example.com/", occurredAt: at });
    const p = await resolvePeriodParams(db, ws, { range: "7d", compare: "year" });
    expect(p).toMatchObject({ start: "2026-03-09", end: "2026-03-15", range: "7d", compare: "year" });
    expect(p.comparison).toEqual({ start: "2025-03-09", end: "2025-03-15" });
    // Calendar presets still follow today.
    const mtd = await resolvePeriodParams(db, ws, { range: "mtd" });
    expect(mtd.end).toBe(todayIn(ws.timezone));
  });

  it("accepts a custom range, rejects impossible dates and unknown values", async () => {
    const custom = await resolvePeriodParams(db, ws, { from: "2026-08-01", to: "2026-08-10", compare: "none", model: "first_touch", platform: "meta" });
    expect(custom).toMatchObject({ range: "custom", start: "2026-08-01", end: "2026-08-10", comparison: null, model: "first_touch", platform: "meta" });
    const bad = await resolvePeriodParams(db, ws, { from: "2026-02-30", to: "2026-03-01", range: "bogus", model: "x", platform: "nope" });
    expect(bad).toMatchObject({ range: "30d", model: "linear", platform: undefined });
    const reversed = await resolvePeriodParams(db, ws, { from: "2026-08-10", to: "2026-08-01" });
    expect(reversed.range).toBe("30d");
  });
});
