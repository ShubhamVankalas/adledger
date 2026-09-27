import { describe, expect, it } from "vitest";
import { FLAT_THRESHOLD, formatMetric, METRIC_KEYS, metricDelta, METRICS, ratioX } from "@/lib/metrics";
import { metricValues } from "@/lib/reports-metrics";

describe("metric registry", () => {
  it("defines every metric with a label, definition, polarity and source", () => {
    for (const k of METRIC_KEYS) {
      const m = METRICS[k];
      expect(m.key).toBe(k);
      expect(m.label.length).toBeGreaterThan(1);
      expect(m.definition.length).toBeGreaterThan(20);
      expect(m.source).toMatch(/^reports/);
      expect(m.definition).not.toMatch(/—/);
    }
  });

  it("uses the documented polarity: spend neutral, CAC/CPL/unattributed down-is-good", () => {
    expect(METRICS.spend.polarity).toBe("neutral");
    expect(METRICS.cac.polarity).toBe("down");
    expect(METRICS.cpl.polarity).toBe("down");
    expect(METRICS.unattributedShare.polarity).toBe("down");
    expect(METRICS.revenue.polarity).toBe("up");
    expect(METRICS.roas.polarity).toBe("up");
  });
});

describe("metricDelta", () => {
  it("colours changes by polarity", () => {
    expect(metricDelta(120, 100, "up")).toMatchObject({ direction: "up", tone: "good", text: "20.0%" });
    expect(metricDelta(80, 100, "up")).toMatchObject({ direction: "down", tone: "bad" });
    // CAC going down is good, going up is bad.
    expect(metricDelta(80, 100, "down")).toMatchObject({ direction: "down", tone: "good" });
    expect(metricDelta(120, 100, "down")).toMatchObject({ direction: "up", tone: "bad" });
    // Spend is neutral either way.
    expect(metricDelta(150, 100, "neutral").tone).toBe("neutral");
    expect(metricDelta(50, 100, "neutral").tone).toBe("neutral");
  });

  it("reads changes under 2% as flat", () => {
    expect(FLAT_THRESHOLD).toBe(0.02);
    expect(metricDelta(101.9, 100, "up")).toMatchObject({ tone: "flat", direction: "flat", text: "Flat" });
    expect(metricDelta(98.1, 100, "down").tone).toBe("flat");
    expect(metricDelta(102, 100, "up").tone).toBe("good");
  });

  it("has no comparison without a previous value", () => {
    expect(metricDelta(100, 0, "up").tone).toBe("none");
    expect(metricDelta(100, null, "up").change).toBeNull();
    expect(metricDelta(null, 100, "up").tone).toBe("none");
  });

  it("caps absurd changes and describes them for screen readers", () => {
    expect(metricDelta(10_000, 1, "up").text).toBe(">999%");
    expect(metricDelta(80, 100, "down").label).toBe("Down 20.0% vs previous period, better");
  });
});

describe("formatting", () => {
  it("shows ratios as ×, never x or NaN", () => {
    expect(ratioX(3.254)).toBe("3.25×");
    expect(ratioX(0)).toBe("0×");
    expect(ratioX(null)).toBe("—");
    expect(ratioX(Number.NaN)).toBe("—");
  });

  it("formats each metric in its unit", () => {
    expect(formatMetric("revenue", 5_539_000, "USD", { compact: true })).toBe("$55.4K");
    expect(formatMetric("revenue", 5_539_000, "USD")).toBe("$55,390");
    expect(formatMetric("roas", 1.766, "USD")).toBe("1.77×");
    expect(formatMetric("unattributedShare", 0.172, "USD")).toBe("17.2%");
    expect(formatMetric("leads", 4.5, "USD", { compact: true })).toBe("4.5");
    expect(formatMetric("cac", null, "USD")).toBe("—");
  });
});

describe("metricValues", () => {
  it("derives ratios exactly like overview()", () => {
    const v = metricValues({
      spendMinor: 10_000,
      revenueMinor: 30_000,
      attributedRevenueMinor: 25_000,
      unattributedRevenueMinor: 3_000,
      leads: 12,
      paidLeads: 7.5,
      customers: 3,
      paidCustomers: 2.5,
    });
    expect(v).toMatchObject({ roas: 2.5, mer: 3, cpl: 1333, cac: 4000, unattributedShare: 0.1 });
    const empty = metricValues({ spendMinor: 0, revenueMinor: 0, attributedRevenueMinor: 0, unattributedRevenueMinor: 0, leads: 0, paidLeads: 0, customers: 0, paidCustomers: 0 });
    expect(empty).toMatchObject({ roas: null, mer: null, cpl: null, cac: null, unattributedShare: null });
  });
});
