import { parseUnits } from "@agentspend/core";
import { z } from "zod";
import { ApiError } from "./api";

/** Human-entered decimal amount -> integer base units. Never uses floats. */
export function decimalToUnits(value: string, label: string): string {
  try {
    const units = parseUnits(value);
    if (units <= 0n) throw new Error("must be greater than zero");
    return units.toString();
  } catch (error) {
    throw new ApiError(
      400,
      "INVALID_AMOUNT",
      `${label} must be a positive amount with at most 6 decimal places.`,
    );
  }
}

export function decimalToUnitsAllowZero(value: string, label: string): string {
  try {
    return parseUnits(value).toString();
  } catch {
    throw new ApiError(
      400,
      "INVALID_AMOUNT",
      `${label} must be a non-negative amount with at most 6 decimal places.`,
    );
  }
}

export const decimalSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Use a decimal amount with at most 6 decimal places.");

export const optionalDecimalSchema = decimalSchema.optional();
