import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isFulfillable, isTerminal } from "./state";

describe("payment state machine", () => {
  it("allows the happy path", () => {
    const path = [
      "created",
      "policy_checking",
      "authorized",
      "submitted",
      "confirming",
      "succeeded",
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows approval and reconciliation paths", () => {
    expect(canTransition("policy_checking", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "authorized")).toBe(true);
    expect(canTransition("unknown", "succeeded")).toBe(true);
    expect(canTransition("unknown", "failed")).toBe(true);
  });

  it("forbids terminal states from moving backwards", () => {
    for (const terminal of ["succeeded", "denied", "cancelled", "expired", "failed"] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(canTransition(terminal, "confirming")).toBe(false);
      expect(canTransition(terminal, "succeeded")).toBe(false);
    }
    expect(() => assertTransition("succeeded", "submitted")).toThrow(/illegal/);
  });

  it("only fulfils from succeeded", () => {
    expect(isFulfillable("succeeded")).toBe(true);
    expect(isFulfillable("confirming")).toBe(false);
    expect(isFulfillable("unknown")).toBe(false);
  });
});
