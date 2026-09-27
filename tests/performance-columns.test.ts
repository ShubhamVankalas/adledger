import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  deltaTone,
  formatValue,
  nextSort,
  parseCols,
  PRESETS,
  readTableState,
  roasBar,
  sortRows,
  statusLabel,
  stoplight,
  tableStatePatch,
} from "@/components/performance/columns";
import { CSV_HEAD, performanceCsv } from "@/components/performance/csv";
import type { PerfRowV2 } from "@/lib/reports-performance";

const sp = (qs: string) => new URLSearchParams(qs);

describe("table state in the URL", () => {
  it("defaults to the Default preset, spend descending, comfortable table", () => {
    const s = readTableState(sp(""));
    expect(s).toMatchObject({ preset: "default", sort: { key: "spendMinor", dir: -1 }, density: "comfortable", mode: "table", peek: null });
    expect(s.columns).toEqual(PRESETS[0].cols);
    // ROAS stays the last column (the answer), Spend the first (the CSV/API spot-checks rely on it).
    expect(s.columns[0]).toBe("spendMinor");
    expect(s.columns.at(-1)).toBe("roas");
  });

  it("reads presets, custom columns, sort, density, mode and peek", () => {
    expect(readTableState(sp("preset=leadgen")).columns).toEqual(PRESETS.find((p) => p.key === "leadgen")!.cols);
    const custom = readTableState(sp("preset=leadgen&cols=roas,spendMinor,bogus,roas"));
    expect(custom).toMatchObject({ preset: "custom", columns: ["roas", "spendMinor"] });
    expect(readTableState(sp("sort=cplMinor&dir=asc")).sort).toEqual({ key: "cplMinor", dir: 1 });
    expect(readTableState(sp("sort=name")).sort).toEqual({ key: "name", dir: 1 });
    expect(readTableState(sp("sort=drop table")).sort).toEqual({ key: "spendMinor", dir: -1 });
    expect(readTableState(sp("density=compact&mode=quadrant")).density).toBe("compact");
    expect(readTableState(sp("mode=quadrant")).mode).toBe("quadrant");
    expect(readTableState(sp("peek=00000000-0000-0000-0000-000000000001")).peek).toBe("00000000-0000-0000-0000-000000000001");
    expect(readTableState(sp("peek=<script>")).peek).toBeNull();
    expect(readTableState(sp("preset=nope")).preset).toBe("default");
    expect(parseCols("")).toBeNull();
    expect(parseCols("x,y")).toBeNull();
  });

  it("writes short URLs: defaults are left out, a preset's own columns stay a preset", () => {
    expect(tableStatePatch({ preset: "default" })).toEqual({ preset: null, cols: null });
    expect(tableStatePatch({ preset: "ecommerce" })).toEqual({ preset: "ecommerce", cols: null });
    expect(tableStatePatch({ preset: "custom", columns: ["roas", "spendMinor"] })).toEqual({ preset: null, cols: "roas,spendMinor" });
    // Columns identical to a preset collapse back to that preset.
    expect(tableStatePatch({ preset: "creative", columns: [...PRESETS[3].cols] })).toEqual({ preset: "creative", cols: null });
    expect(tableStatePatch({ sort: { key: "spendMinor", dir: -1 } })).toEqual({ sort: null, dir: null });
    expect(tableStatePatch({ sort: { key: "roas", dir: 1 } })).toEqual({ sort: "roas", dir: "asc" });
    expect(tableStatePatch({ density: "comfortable", mode: "table" })).toEqual({ density: null, mode: null });
    expect(tableStatePatch({ peek: null })).toEqual({ peek: null });
  });

  it("round-trips through the URL", () => {
    const patch = tableStatePatch({ preset: "custom", columns: ["ctr", "roas"], sort: { key: "ctr", dir: 1 }, density: "compact", mode: "quadrant" });
    const qs = new URLSearchParams(Object.entries(patch).filter((e): e is [string, string] => e[1] !== null));
    expect(readTableState(qs)).toMatchObject({ preset: "custom", columns: ["ctr", "roas"], sort: { key: "ctr", dir: 1 }, density: "compact", mode: "quadrant" });
  });

  it("every preset column exists and every column has a definition", () => {
    const keys = new Set(COLUMNS.map((c) => c.key));
    for (const p of PRESETS) for (const c of p.cols) expect(keys.has(c)).toBe(true);
    for (const c of COLUMNS) expect(c.hint.length).toBeGreaterThan(10);
  });
});

describe("sorting", () => {
  const rows = [
    { name: "B", status: null, roas: 2, cplMinor: 500 },
    { name: "A", status: null, roas: null, cplMinor: null },
    { name: "C", status: null, roas: 0.5, cplMinor: 100 },
  ];
  it("sorts both ways and always sinks empty values", () => {
    expect(sortRows(rows, { key: "roas", dir: -1 }).map((r) => r.name)).toEqual(["B", "C", "A"]);
    expect(sortRows(rows, { key: "roas", dir: 1 }).map((r) => r.name)).toEqual(["C", "B", "A"]);
    expect(sortRows(rows, { key: "name", dir: 1 }).map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
  it("picks a natural first direction per column", () => {
    expect(nextSort({ key: "spendMinor", dir: -1 }, "cplMinor")).toEqual({ key: "cplMinor", dir: 1 });
    expect(nextSort({ key: "spendMinor", dir: -1 }, "roas")).toEqual({ key: "roas", dir: -1 });
    expect(nextSort({ key: "roas", dir: -1 }, "roas")).toEqual({ key: "roas", dir: 1 });
    expect(nextSort({ key: "roas", dir: -1 }, "name")).toEqual({ key: "name", dir: 1 });
  });
});

describe("stoplights, bars and deltas", () => {
  it("colours against a target by polarity", () => {
    expect(stoplight(3.2, 3, "up")).toBe("good");
    expect(stoplight(2.5, 3, "up")).toBe("warn");
    expect(stoplight(2, 3, "up")).toBe("bad");
    expect(stoplight(9_000, 10_000, "down")).toBe("good");
    expect(stoplight(11_500, 10_000, "down")).toBe("warn");
    expect(stoplight(13_000, 10_000, "down")).toBe("bad");
    expect(stoplight(null, 3, "up")).toBeNull();
    expect(stoplight(3, undefined, "up")).toBeNull();
    expect(stoplight(3, 0, "up")).toBeNull();
  });
  it("caps the ROAS bar at twice the target", () => {
    expect(roasBar(4, 12, 3)).toBeCloseTo(4 / 6);
    expect(roasBar(12, 12, 3)).toBe(1);
    expect(roasBar(1, 1.5)).toBeCloseTo(1 / 1.5);
    expect(roasBar(1, 0.5)).toBe(1);
    expect(roasBar(null, 3)).toBe(0);
    expect(roasBar(0, 3)).toBe(0);
  });
  it("tones deltas by polarity with a flat band", () => {
    expect(deltaTone(0.1, "up")).toBe("good");
    expect(deltaTone(0.1, "down")).toBe("bad");
    expect(deltaTone(-0.1, "down")).toBe("good");
    expect(deltaTone(0.3, "neutral")).toBe("neutral");
    expect(deltaTone(0.01, "up")).toBe("flat");
  });
});

describe("formatting", () => {
  it("formats every column kind honestly", () => {
    expect(formatValue("money", 123_456, "USD")).toBe("$1,235");
    expect(formatValue("money", 1_234_567, "USD", true)).toBe("$12.3K");
    expect(formatValue("ratio", 2.345, "USD")).toBe("2.35×");
    expect(formatValue("ratio", 0, "USD")).toBe("0×");
    expect(formatValue("percent", 0.0134, "USD")).toBe("1.34%");
    expect(formatValue("percent", 0.5, "USD")).toBe("50.0%");
    expect(formatValue("gap", 1.29, "USD")).toBe("+129%");
    expect(formatValue("gap", -0.1, "USD")).toBe("−10%");
    expect(formatValue("credit", 4.5, "USD")).toBe("4.5");
    expect(formatValue("count", 12345, "USD")).toBe("12,345");
    expect(formatValue("money", null, "USD")).toBe("—");
  });
  it("turns platform statuses into short labels", () => {
    expect(statusLabel("ACTIVE")).toEqual({ label: "Active", tone: "active" });
    expect(statusLabel("ENABLED")).toEqual({ label: "Active", tone: "active" });
    expect(statusLabel("CAMPAIGN_PAUSED")).toEqual({ label: "Paused", tone: "paused" });
    expect(statusLabel("archived")).toEqual({ label: "Ended", tone: "other" });
    expect(statusLabel("IN_REVIEW")).toEqual({ label: "In review", tone: "other" });
    expect(statusLabel(null)).toBeNull();
  });
});

describe("CSV export", () => {
  it("keeps the v1 columns and escapes names", () => {
    const row = {
      id: "1",
      name: 'Brand, "exact"',
      platform: "google",
      status: null,
      parentId: null,
      parentName: null,
      spendMinor: 12_345,
      impressions: 1000,
      clicks: 10,
      leads: 2.5,
      customers: 1,
      revenueMinor: 50_000,
      roas: 4.05022,
      cplMinor: 4_938,
      cacMinor: null,
      delta: null,
      quadrant: null,
    } as unknown as PerfRowV2;
    const [head, line] = performanceCsv([row], "USD").split("\n");
    expect(head).toBe(CSV_HEAD.join(","));
    expect(head).toBe("name,platform,parent,spend,impressions,clicks,leads,customers,revenue,roas,cpl,cac,currency");
    expect(line).toBe('"Brand, ""exact""",google,,123.45,1000,10,2.5,1,500,4.0502,49.38,,USD');
  });
});
