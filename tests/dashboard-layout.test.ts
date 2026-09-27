import { describe, expect, it } from "vitest";
import { buildBriefing, periodPhrase } from "@/lib/dashboard/briefing";
import { insightBullets } from "@/lib/dashboard/insight";
import { isLayoutShape, parseLayout } from "@/lib/dashboard/layout";
import { addSection, addWidget, canDrop, deleteSection, locate, moveItem, moveItemBy, PINNED, removeItem, renameSection, setItemSize, togglePin, typesOnBoard } from "@/lib/dashboard/ops";
import { defaultPresetFor, PRESETS, presetLayout } from "@/lib/dashboard/presets";
import { canEditScope, defaultEditScope, deleteDashboard, resolveDashboard, saveDashboard, updateDashboard } from "@/lib/dashboard/store";
import { MAX_PINNED, PRESET_KEYS, type Layout } from "@/lib/dashboard/types";
import { schema } from "@/lib/db";
import { roleCan, type Permission } from "@/lib/permissions";
import { isKpiType, WIDGETS, widgetMeta } from "@/lib/widgets/catalog";
import { setupWorkspace } from "./helpers";

const minimal = () => presetLayout("minimal");

describe("layout parsing", () => {
  it("round-trips every preset unchanged", () => {
    for (const k of PRESET_KEYS) {
      const layout = presetLayout(k);
      expect(parseLayout(JSON.parse(JSON.stringify(layout)), minimal()), k).toEqual(layout);
    }
  });

  it("falls back to the preset when the stored value isn't a v1 layout", () => {
    for (const garbage of [null, "nope", 42, [], { v: 2, pinned: [], sections: [] }, { pinned: [] }]) {
      expect(parseLayout(garbage, minimal())).toEqual(minimal());
      expect(isLayoutShape(garbage)).toBe(false);
    }
  });

  it("keeps unknown widget types so they render a 'Widget unavailable' card", () => {
    const raw = { v: 1, pinned: [{ id: "x1", type: "kpi.ncRoas", size: "s" }], sections: [{ id: "s1", title: "A", collapsed: false, items: [{ id: "x2", type: "chart.funnel", size: "xl" }] }] };
    const out = parseLayout(raw, minimal());
    expect(out.pinned[0].type).toBe("kpi.ncRoas");
    expect(out.sections[0].items[0]).toEqual({ id: "x2", type: "chart.funnel", size: "xl" });
    expect(widgetMeta("chart.funnel")).toBeUndefined();
  });

  it("drops invalid items and repairs sizes, settings and titles", () => {
    const raw = {
      v: 1,
      pinned: [
        { id: "a", type: "kpi.roas", size: "xl" },
        { id: "b", type: "chart.explorer", size: "xl" }, // not a KPI: can't be pinned
        { id: "bad id!", type: "kpi.mer", size: "s" }, // invalid id
        { id: "c", type: "kpi.roas", size: "s" }, // duplicate single-instance type
      ],
      sections: [
        {
          id: "s1",
          title: "  Money   in  " + "x".repeat(80),
          collapsed: "yes",
          items: [
            { id: "d", type: "list.topCampaigns", size: "xl", settings: { sort: "roas", topN: 99, junk: true, metric: "nope" } },
            { id: "d", type: "list.platforms", size: "m" }, // duplicate id
            { id: "e", type: "<script>", size: "m" }, // invalid type
            { id: "f", type: "chart.explorer", size: "m" },
            { id: "g", type: "chart.explorer", size: "l", settings: { metric: "roas" } }, // multi-instance ok
          ],
        },
      ],
    };
    const out = parseLayout(raw, minimal());
    expect(out.pinned).toEqual([{ id: "a", type: "kpi.roas", size: "s" }]);
    const s = out.sections[0];
    expect(s.title.startsWith("Money in x")).toBe(true);
    expect(s.title.length).toBeLessThanOrEqual(60);
    expect(s.collapsed).toBe(false);
    expect(s.items.map((w) => w.id)).toEqual(["d", "f", "g"]);
    expect(s.items[0]).toEqual({ id: "d", type: "list.topCampaigns", size: "m", settings: { sort: "roas" } });
    expect(s.items[1].size).toBe("xl"); // explorer allows l/xl only
    expect(s.items[2].settings).toEqual({ metric: "roas" });
  });

  it("enforces the pinned, section and item limits", () => {
    const kpis = WIDGETS.filter((w) => isKpiType(w.type));
    const raw = {
      v: 1,
      pinned: kpis.map((w, i) => ({ id: `k${i}`, type: w.type, size: "s" })),
      sections: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, collapsed: false, items: Array.from({ length: 30 }, (_, j) => ({ id: `e${i}-${j}`, type: "chart.explorer", size: "xl" })) })),
    };
    const out = parseLayout(raw, minimal());
    expect(out.pinned).toHaveLength(MAX_PINNED);
    expect(out.sections).toHaveLength(12);
    expect(out.sections[0].items).toHaveLength(24);
  });
});

describe("presets", () => {
  it("only use registered widgets in allowed sizes, with unique ids", () => {
    for (const k of PRESET_KEYS) {
      const { layout, label, description } = PRESETS[k];
      expect(label).toBeTruthy();
      expect(description).toBeTruthy();
      expect(layout.pinned.length).toBeGreaterThan(0);
      expect(layout.pinned.length).toBeLessThanOrEqual(MAX_PINNED);
      expect(layout.pinned.every((w) => isKpiType(w.type))).toBe(true);
      const all = [...layout.pinned, ...layout.sections.flatMap((s) => s.items)];
      const ids = [...all.map((w) => w.id), ...layout.sections.map((s) => s.id)];
      expect(new Set(ids).size, k).toBe(ids.length);
      for (const w of all) {
        const meta = widgetMeta(w.type);
        expect(meta, `${k}: ${w.type}`).toBeDefined();
        expect(meta!.allowedSizes, `${k}: ${w.type}`).toContain(w.size);
      }
    }
  });

  it("start fresh workspaces minimal and the demo on the fuller board", () => {
    expect(defaultPresetFor({ isDemo: false })).toBe("minimal");
    expect(defaultPresetFor({ isDemo: true })).toBe("ecommerce");
    expect(PRESETS.minimal.layout.pinned.map((w) => w.type)).toEqual(["kpi.revenue", "kpi.spend", "kpi.roas", "kpi.customers"]);
  });
});

describe("layout operations", () => {
  it("adds KPI tiles to the strip while it has room, other widgets to the first section", () => {
    let l = minimal();
    const r = addWidget(l, "kpi.mer");
    expect(r.id).toBeTruthy();
    expect(r.layout.pinned.at(-1)?.type).toBe("kpi.mer");
    l = addWidget(r.layout, "list.platforms").layout;
    expect(l.sections[0].items.at(-1)?.type).toBe("list.platforms");
    // Single-instance widgets can't be added twice; the explorer can.
    expect(addWidget(l, "list.platforms").id).toBeNull();
    const e1 = addWidget(l, "chart.explorer");
    const e2 = addWidget(e1.layout, "chart.explorer");
    expect(e2.id).not.toBe(e1.id);
    expect(addWidget(l, "chart.unknown").id).toBeNull();
  });

  it("moves widgets across sections and only KPI tiles into the strip", () => {
    const l = minimal();
    const chart = l.sections[0].items[0];
    expect(canDrop(l, chart, PINNED)).toBe(false);
    expect(moveItem(l, chart.id, PINNED, 0)).toBe(l);
    const moved = moveItem(l, chart.id, l.sections[1].id, 1);
    expect(locate(moved, chart.id)).toMatchObject({ container: l.sections[1].id, index: 1 });
    // Crossing section edges with moveItemBy.
    const back = moveItemBy(moveItemBy(moved, chart.id, -1), chart.id, -1);
    expect(locate(back, chart.id)?.container).toBe(l.sections[0].id);
    // A KPI from a section can be pinned; the strip holds six.
    const withKpi = addWidget(l, "kpi.mer", l.sections[0].id).layout;
    const kpi = withKpi.sections[0].items.at(-1)!;
    expect(locate(moveItem(withKpi, kpi.id, PINNED, 0), kpi.id)).toMatchObject({ container: PINNED, index: 0 });
  });

  it("resizes only to allowed sizes and removes widgets", () => {
    const l = minimal();
    const top = l.sections[1].items[0]; // top campaigns: m or l
    expect(locate(setItemSize(l, top.id, "l"), top.id)?.item.size).toBe("l");
    expect(setItemSize(l, top.id, "xl")).toBe(l);
    expect(locate(removeItem(l, top.id), top.id)).toBeNull();
  });

  it("pins and unpins KPI tiles", () => {
    const l = minimal();
    const off = togglePin(l, "kpi.roas")!;
    expect(off.pinned).toBe(false);
    expect(typesOnBoard(off.layout).has("kpi.roas")).toBe(false);
    const on = togglePin(off.layout, "kpi.roas")!;
    expect(on.pinned).toBe(true);
    expect(on.layout.pinned.at(-1)?.type).toBe("kpi.roas");
    expect(togglePin(l, "chart.explorer")).toBeNull();
    const full: Layout = { ...l, pinned: presetLayout("ecommerce").pinned };
    expect(togglePin(full, "kpi.leads")).toBeNull();
  });

  it("adds, renames, reorders and deletes sections", () => {
    const { layout, id } = addSection(minimal(), "CRM");
    expect(layout.sections.at(-1)).toMatchObject({ id, title: "CRM", items: [] });
    const renamed = renameSection(layout, id!, "  Pipeline   health ");
    expect(renamed.sections.at(-1)?.title).toBe("Pipeline health ");
    expect(deleteSection(renamed, id!).sections).toHaveLength(2);
  });
});

describe("permissions", () => {
  const can = (role: Parameters<typeof roleCan>[0]) => (p: Permission) => roleCan(role, p);

  it("lets everyone save a personal view but only admins the workspace default", () => {
    for (const role of ["owner", "admin", "analyst", "viewer", "client"] as const) {
      expect(roleCan(role, "dashboard.edit")).toBe(true);
      expect(canEditScope(can(role), "personal")).toBe(true);
    }
    expect(canEditScope(can("owner"), "workspace")).toBe(true);
    expect(canEditScope(can("admin"), "workspace")).toBe(true);
    expect(canEditScope(can("analyst"), "workspace")).toBe(false);
    expect(canEditScope(can("client"), "workspace")).toBe(false);
    expect(canEditScope(() => false, "personal")).toBe(false);
  });

  it("sends edits to the personal view unless an admin has none", () => {
    expect(defaultEditScope({ hasPersonal: true, canEditWorkspace: true })).toBe("personal");
    expect(defaultEditScope({ hasPersonal: false, canEditWorkspace: true })).toBe("workspace");
    expect(defaultEditScope({ hasPersonal: false, canEditWorkspace: false })).toBe("personal");
  });
});

describe("dashboards table", () => {
  it("resolves personal → workspace → preset and rejects stale saves", async () => {
    const { db, ws } = await setupWorkspace();
    const [user] = await db.insert(schema.users).values({ email: `dash-${Date.now()}@test.dev`, passwordHash: "x" }).returning();

    let r = await resolveDashboard(db, ws, user.id);
    expect(r.source).toBe("preset");
    expect(r.layout).toEqual(presetLayout("minimal"));

    // Workspace default.
    const shared = presetLayout("agency");
    expect(await saveDashboard(db, { workspaceId: ws.id, userId: null, layout: shared, preset: "agency", expectedVersion: 0 })).toEqual({ ok: true, version: 1 });
    // A second "create" of the same scope conflicts (unique key treats null user_id as equal).
    expect(await saveDashboard(db, { workspaceId: ws.id, userId: null, layout: shared, preset: "agency", expectedVersion: 0 })).toEqual({ ok: false, conflict: true });
    r = await resolveDashboard(db, ws, user.id);
    expect(r).toMatchObject({ source: "workspace", preset: "agency", versions: { workspace: 1, personal: 0 } });

    // Personal override wins; stale versions are rejected.
    const mine = removeItem(shared, shared.pinned[0].id);
    expect(await saveDashboard(db, { workspaceId: ws.id, userId: user.id, layout: mine, preset: "agency", expectedVersion: 0 })).toEqual({ ok: true, version: 1 });
    expect(await saveDashboard(db, { workspaceId: ws.id, userId: user.id, layout: shared, preset: "agency", expectedVersion: 5 })).toEqual({ ok: false, conflict: true });
    r = await resolveDashboard(db, ws, user.id);
    expect(r.source).toBe("personal");
    expect(r.layout).toEqual(mine);
    expect(r.workspaceLayout).toEqual(shared);

    // Read-modify-write pin toggle bumps the version.
    const pinned = await updateDashboard(db, { workspaceId: ws.id, userId: user.id, base: r.layout, preset: r.preset }, (l) => togglePin(l, "kpi.mer")?.layout ?? null);
    expect(pinned?.version).toBe(2);
    expect(pinned?.layout.pinned.at(-1)?.type).toBe("kpi.mer");

    // Reset personal → back to the workspace default.
    expect(await deleteDashboard(db, ws.id, user.id)).toBe(true);
    expect((await resolveDashboard(db, ws, user.id)).source).toBe("workspace");
  });

  it("degrades a corrupted stored layout to the preset instead of failing", async () => {
    const { db, ws } = await setupWorkspace();
    await db.insert(schema.dashboards).values({ workspaceId: ws.id, userId: null, preset: "leadgen", layout: { v: 9, broken: true } });
    const r = await resolveDashboard(db, ws, "00000000-0000-0000-0000-000000000000");
    expect(r.layout).toEqual(presetLayout("leadgen"));
  });
});

describe("briefing sentence", () => {
  const base = { spendMinor: 0, revenueMinor: 0, attributedRevenueMinor: 0, roas: null, prevRoas: null };
  it("names the campaign with the most profit, not the most revenue", () => {
    const b = buildBriefing({
      ...base,
      spendMinor: 30_000,
      roas: 2.2,
      prevRoas: 2,
      campaigns: [
        { id: "a", name: "Big but costly", platform: "meta", spendMinor: 20_000, revenueMinor: 25_000 },
        { id: "b", name: "Lean winner", platform: "google", spendMinor: 5_000, revenueMinor: 15_000 },
      ],
    });
    expect(b).toMatchObject({ kind: "top", campaign: { id: "b" }, revenueMinor: 15_000, spendMinor: 5_000, roasDelta: { tone: "good", text: "10.0%" } });
  });

  it("is honest when nothing paid back, nothing was spent, or there is no data", () => {
    expect(buildBriefing({ ...base, spendMinor: 100, campaigns: [{ id: "a", name: "A", platform: "meta", spendMinor: 100, revenueMinor: 50 }] }).kind).toBe("noProfit");
    expect(buildBriefing({ ...base, revenueMinor: 900, campaigns: [] })).toEqual({ kind: "noSpend", revenueMinor: 900 });
    expect(buildBriefing({ ...base, campaigns: [] })).toEqual({ kind: "empty" });
  });

  it("names the period in plain words", () => {
    expect(periodPhrase("7d")).toEqual({ inPeriod: "this week", vsPrevious: "last week" });
    expect(periodPhrase("30d").inPeriod).toBe("in the last 30 days");
    expect(periodPhrase("custom").inPeriod).toBe("in this period");
  });
});

describe("AI insight bullets", () => {
  it("picks a win, a waste and the first recommendation from the weekly report", () => {
    const md = [
      "## Summary",
      "**Sep 20 – 26:** you spent **$4,000**.",
      "",
      "## What's working",
      "- **Search – Brand** (Google): $8,000 in revenue on $600 of spend, a 13.3x return.",
      "- **Other** (Meta): fine.",
      "",
      "## Wasted spend",
      "- **Broad – Interest Stack** (Meta): $2,775 spent with no leads and no attributed revenue.",
      "",
      "## Recommendations",
      "1. Pause or rework **Broad – Interest Stack**.",
      "2. Shift budget.",
    ].join("\n");
    const b = insightBullets(md);
    expect(b.map((x) => x.tone)).toEqual(["good", "bad", "action"]);
    expect(b[0].text).toContain("Search – Brand");
    expect(b[2].text).toBe("Pause or rework **Broad – Interest Stack**.");
    expect(insightBullets("no lists here")).toEqual([]);
  });
});
