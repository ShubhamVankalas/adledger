import { describe, expect, it } from "vitest";
import {
  countLabel,
  credit,
  creditTitle,
  dateRange,
  moneyDelta,
  moneyShort,
  moneyWhole,
  pct,
  platformLabel,
  reportSourceLabel,
  roas,
  signedPct,
} from "@/lib/format";

describe("display formatting", () => {
  it("money: whole units in tables, compact in secondary text", () => {
    expect(moneyWhole(4129391, "USD")).toBe("$41,294");
    expect(moneyWhole(15650, "USD")).toBe("$157");
    expect(moneyWhole(450, "USD")).toBe("$4.50");
    expect(moneyWhole(500, "USD")).toBe("$5");
    expect(moneyWhole(0, "USD")).toBe("$0");
    expect(moneyWhole(-250000, "USD")).toBe("−$2,500");
    expect(moneyWhole(null, "USD")).toBe("—");
    expect(moneyWhole(123456, "JPY")).toBe("¥123,456");
    expect(moneyShort(78560, "USD")).toBe("$786");
    expect(moneyShort(4129391, "USD")).toBe("$41.3K");
    expect(moneyDelta(-2150000, "USD")).toBe("−$21.5K");
    expect(moneyDelta(31300, "USD")).toBe("+$313");
  });

  it("credited counts: whole from 10, one decimal below", () => {
    expect(credit(243.5)).toBe("244");
    expect(credit(51.5)).toBe("52");
    expect(credit(4.5)).toBe("4.5");
    expect(credit(0.5)).toBe("0.5");
    expect(credit(3)).toBe("3");
    expect(credit(0)).toBe("0");
    expect(creditTitle(51.5, "customers")).toContain("51.5 customers");
    expect(creditTitle(52, "customers")).toBeUndefined();
    expect(countLabel(1, "lead")).toBe("1 lead");
    expect(countLabel(9.5, "lead")).toBe("9.5 leads");
    expect(countLabel(0, "customer")).toBe("0 customers");
  });

  it("ratios and percentages", () => {
    expect(roas(1.7634)).toBe("1.76x");
    expect(roas(0)).toBe("0x");
    expect(roas(0.001)).toBe("0x");
    expect(roas(null)).toBe("—");
    expect(signedPct(0.152)).toBe("+15.2%");
    expect(signedPct(-0.001)).toBe("−0.1%");
    expect(signedPct(0.00001)).toBe("0%");
    expect(pct(-0.25)).toBe("−25.0%");
    expect(pct(-0.00001)).toBe("0.0%");
  });

  it("dates, platforms and report sources", () => {
    expect(dateRange("2026-09-20", "2026-09-26")).toBe("Sep 20 – 26");
    expect(dateRange("2026-09-20", "2026-09-26", { year: true })).toBe("Sep 20 – 26, 2026");
    expect(dateRange("2026-08-29", "2026-09-26")).toBe("Aug 29 – Sep 26");
    expect(dateRange("2025-12-28", "2026-01-03")).toBe("Dec 28, 2025 – Jan 3, 2026");
    expect(platformLabel("linkedin")).toBe("LinkedIn");
    expect(platformLabel("some_new_platform")).toBe("Some new platform");
    expect(reportSourceLabel("template")).toBe("Rule-based");
    expect(reportSourceLabel("openai/gpt-5-mini")).toBe("gpt-5-mini via OpenAI");
    expect(reportSourceLabel("custom/my-model")).toBe("my-model");
  });
});
