import { describe, expect, it } from "vitest";
import { formatCount, parseCountable } from "@/lib/count-up";

describe("count-up parsing", () => {
  it("splits formatted numbers into prefix, digits and suffix", () => {
    expect(parseCountable("$41,294")).toEqual({ prefix: "$", suffix: "", value: 41294, decimals: 0, grouped: true });
    expect(parseCountable("2.35x")).toEqual({ prefix: "", suffix: "x", value: 2.35, decimals: 2, grouped: false });
    expect(parseCountable("−12.5%")).toEqual({ prefix: "−", suffix: "%", value: 12.5, decimals: 1, grouped: false });
    expect(parseCountable("$41.3K")).toMatchObject({ prefix: "$", suffix: "K", value: 41.3, decimals: 1 });
    expect(parseCountable("−$1,204")).toMatchObject({ prefix: "−$", value: 1204, grouped: true });
  });

  it("leaves anything that is not one plain number alone", () => {
    for (const text of ["—", "", "n/a", "12:30", "3 of 40", "1.2.3", "1,23", "$1,2345", "10 / 20"]) {
      expect(parseCountable(text), text).toBeNull();
    }
  });

  it("re-renders in the original shape, and the end value reproduces the source text exactly", () => {
    for (const text of ["$41,294", "2.35x", "−12.5%", "$41.3K", "0", "1,000,000", "$4.50"]) {
      const parts = parseCountable(text)!;
      expect(formatCount(parts, parts.value), text).toBe(text);
    }
  });

  it("keeps decimals and grouping while counting", () => {
    const parts = parseCountable("$41,294.50")!;
    expect(formatCount(parts, 0)).toBe("$0.00");
    expect(formatCount(parts, 1234.5)).toBe("$1,234.50");
    expect(formatCount(parseCountable("27")!, 9.6)).toBe("10");
  });
});
