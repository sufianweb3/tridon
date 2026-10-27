/**
 * Monetary primitives. Every amount is an integer count of token base units.
 * USDC on NEAR has 6 decimals, so 1 USDC = 1_000_000n.
 */

export const TOKEN_DECIMALS = 6;
export const BASE_UNITS_PER_UNIT = 10n ** BigInt(TOKEN_DECIMALS);

/** 0.5% expressed in basis points. */
export const USER_FEE_BPS = 50n;
export const MERCHANT_FEE_BPS = 50n;
export const BPS_DENOMINATOR = 10_000n;

export interface Amounts {
  /** What the merchant's service costs. Caps apply to this number. */
  gross: bigint;
  /** 0.5% of gross, debited on top of gross. */
  userFee: bigint;
  /** 0.5% of gross, deducted from gross before payout. */
  merchantFee: bigint;
  /** gross - merchantFee, sent to the merchant. */
  net: bigint;
  /** gross + userFee, removed from the user's vault. */
  debit: bigint;
}

/** Ceiling division: the platform never under-collects by a base unit. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("negative amounts are not allowed");
  return (numerator + denominator - 1n) / denominator;
}

export function feeFor(gross: bigint, bps: bigint): bigint {
  if (gross < 0n) throw new Error("negative amounts are not allowed");
  if (bps < 0n || bps > BPS_DENOMINATOR) throw new Error("invalid basis points");
  return ceilDiv(gross * bps, BPS_DENOMINATOR);
}

export function computeAmounts(
  gross: bigint,
  userFeeBps: bigint = USER_FEE_BPS,
  merchantFeeBps: bigint = MERCHANT_FEE_BPS,
): Amounts {
  if (gross <= 0n) throw new Error("amount must be greater than zero");
  const userFee = feeFor(gross, userFeeBps);
  const merchantFee = feeFor(gross, merchantFeeBps);
  const net = gross - merchantFee;
  if (net <= 0n) throw new Error("merchant fee consumes the whole amount");
  return { gross, userFee, merchantFee, net, debit: gross + userFee };
}

/** Platform revenue for one successful payment, in base units. */
export function platformRevenue(amounts: Amounts): bigint {
  return amounts.userFee + amounts.merchantFee;
}

export function parseUnits(value: string, decimals: number = TOKEN_DECIMALS): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`invalid decimal amount: ${value}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  const padded = fraction.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatUnits(value: bigint, decimals: number = TOKEN_DECIMALS): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/** Display helper: "$3.00" for 3_000_000n. */
export function formatUsd(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const cents = (abs + 5_000n) / 10_000n; // round half-up to cents for display only
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${whole.toString()}.${frac}`;
}

export function formatBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}
