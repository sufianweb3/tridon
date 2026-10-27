import { describe, expect, it } from "vitest";
import {
  computeAmounts,
  feeFor,
  formatUnits,
  formatUsd,
  parseUnits,
  platformRevenue,
} from "./money";

describe("money", () => {
  it("computes the documented $100 example exactly", () => {
    const a = computeAmounts(100_000_000n);
    expect(a.userFee).toBe(500_000n);
    expect(a.merchantFee).toBe(500_000n);
    expect(a.net).toBe(99_500_000n);
    expect(a.debit).toBe(100_500_000n);
    expect(platformRevenue(a)).toBe(1_000_000n);
  });

  it("rounds fees up, never down", () => {
    expect(feeFor(1n, 50n)).toBe(1n);
    expect(feeFor(199n, 50n)).toBe(1n);
    expect(feeFor(200n, 50n)).toBe(1n);
    expect(feeFor(201n, 50n)).toBe(2n);
  });

  it("refuses an amount whose fee consumes the whole payment", () => {
    expect(() => computeAmounts(1n)).toThrow(/consumes/);
  });

  it("parses and formats without floating point", () => {
    expect(parseUnits("3")).toBe(3_000_000n);
    expect(parseUnits("0.000001")).toBe(1n);
    expect(parseUnits("12.345678")).toBe(12_345_678n);
    expect(() => parseUnits("1.0000001")).toThrow(/decimal places/);
    expect(formatUnits(3_000_000n)).toBe("3");
    expect(formatUnits(1n)).toBe("0.000001");
    expect(formatUsd(3_000_000n)).toBe("$3.00");
    expect(formatUsd(99_500_000n)).toBe("$99.50");
  });
});
