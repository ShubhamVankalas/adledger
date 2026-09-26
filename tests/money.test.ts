import { describe, expect, it } from "vitest";
import { allocate, currencyExponent, formatMoney, fromDecimalString, fromMicros } from "@/lib/money";

describe("currency exponents", () => {
  it("knows zero- and three-decimal currencies", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("jpy")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("INR")).toBe(2);
  });
});

describe("fromMicros (Google Ads cost_micros)", () => {
  it("converts exactly", () => {
    expect(fromMicros("1230000", "USD")).toBe(123);
    expect(fromMicros(123_456_789, "USD")).toBe(12346); // 123.456789 -> 123.46
    expect(fromMicros("999999999999999999", "USD")).toBe(100_000_000_000_000); // 99,999,999,999,999.9999 -> no float drift
  });
  it("handles zero-decimal currencies", () => {
    expect(fromMicros("1500000000", "JPY")).toBe(1500);
    expect(fromMicros("1499500000", "JPY")).toBe(1500); // half rounds away from zero
    expect(fromMicros("1499499999", "JPY")).toBe(1499);
  });
  it("handles three-decimal currencies", () => {
    expect(fromMicros("1234567", "KWD")).toBe(1235);
  });
  it("rounds negatives symmetrically", () => {
    expect(fromMicros("-1235000", "USD")).toBe(-124);
  });
});

describe("fromDecimalString (Meta spend)", () => {
  it("parses without floating point", () => {
    expect(fromDecimalString("123.45", "USD")).toBe(12345);
    expect(fromDecimalString("0.1", "USD")).toBe(10);
    expect(fromDecimalString("0.105", "USD")).toBe(11);
    expect(fromDecimalString("1500", "JPY")).toBe(1500);
    expect(fromDecimalString("1.2345", "KWD")).toBe(1235);
    expect(fromDecimalString("19.99", "USD")).toBe(1999);
  });
  it("rejects garbage", () => {
    expect(() => fromDecimalString("abc", "USD")).toThrow();
  });
});

describe("allocate (largest remainder)", () => {
  it("splits evenly with exact sums", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 1])).toEqual([5, 5]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });
  it("respects weights", () => {
    expect(allocate(1000, [3, 1])).toEqual([750, 250]);
  });
  it("splits refunds (negative totals)", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it("handles all-zero weights as equal", () => {
    expect(allocate(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });
  it("always sums exactly (property test with random inputs)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 5000; i++) {
      const total = Math.floor((rand() - 0.2) * 10 ** Math.floor(rand() * 12));
      const n = 1 + Math.floor(rand() * 9);
      const weights = Array.from({ length: n }, () => (rand() < 0.1 ? 0 : rand() * 100));
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every(Number.isInteger)).toBe(true);
      // No part deviates from its exact share by 1 unit or more.
      const wSum = weights.reduce((a, b) => a + b, 0) || n;
      parts.forEach((p, k) => {
        const exact = (total * (wSum === n && weights.every((w) => w === 0) ? 1 : weights[k])) / wSum;
        expect(Math.abs(p - exact)).toBeLessThan(1.0000001);
      });
    }
  });
});

describe("formatMoney", () => {
  it("formats minor units", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
});
