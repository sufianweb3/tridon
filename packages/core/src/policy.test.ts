import { describe, expect, it } from "vitest";
import { approvalHash } from "./approval";
import { evaluatePayment } from "./policy";
import type { ApprovalRef, MerchantRule, Policy, Usage } from "./types";

const NOW = 1_760_000_000_000;

const policy: Policy = {
  id: "pol_1",
  status: "active",
  totalBudget: 100_000_000n, // $100
  perTxLimit: 10_000_000n, // $10
  dailyLimit: 20_000_000n,
  weeklyLimit: 50_000_000n,
  monthlyLimit: 80_000_000n,
  unknownMerchantMode: "deny",
  unknownMerchantCap: 0n,
  approvalMode: "none_within_policy",
  validFrom: NOW - 1000,
  expiresAt: NOW + 86_400_000,
  version: 3,
};

const usage: Usage = {
  totalGrossCommitted: 0n,
  dayGross: 0n,
  weekGross: 0n,
  monthGross: 0n,
  merchantWindowGross: 0n,
  availableDebit: 1_000_000_000n,
};

const merchant: MerchantRule = {
  merchantId: "mrc_api",
  payoutAccount: "merchant.testnet",
  perTxLimit: 0n,
  windowLimit: 0n,
  windowSecs: 0,
  windowSpent: 0n,
  windowStart: 0,
  active: true,
};

function evaluate(overrides: Partial<Parameters<typeof evaluatePayment>[0]> = {}) {
  return evaluatePayment({
    policy,
    agentStatus: "active",
    merchantRule: merchant,
    merchantId: "mrc_api",
    paymentId: "pay_1",
    gross: 3_000_000n,
    requestExpiry: NOW + 60_000,
    now: NOW,
    usage,
    approval: null,
    selectedMerchantIds: new Set<string>(),
    ...overrides,
  });
}

function approved(overrides: Partial<ApprovalRef> = {}): ApprovalRef {
  const base = {
    paymentId: "pay_1",
    merchantId: "mrc_api",
    gross: 3_000_000n,
    requestExpiry: NOW + 60_000,
    policyVersion: 3,
  };
  return {
    ...base,
    hash: approvalHash(base),
    expiresAt: NOW + 120_000,
    ...overrides,
  };
}

describe("policy engine", () => {
  it("allows a $3 payment inside policy and returns exact fees", () => {
    const d = evaluate();
    expect(d.decision).toBe("ALLOW");
    if (d.decision === "ALLOW") {
      expect(d.amounts.userFee).toBe(15_000n);
      expect(d.amounts.merchantFee).toBe(15_000n);
      expect(d.amounts.net).toBe(2_985_000n);
    }
  });

  it("denies above the per-transaction limit before anything else", () => {
    const d = evaluate({ gross: 50_000_000n });
    expect(d).toMatchObject({ decision: "DENY", code: "PER_TX_LIMIT" });
  });

  it("denies unknown merchants when configured to deny", () => {
    const d = evaluate({ merchantRule: null, merchantId: "mrc_unknown" });
    expect(d).toMatchObject({ decision: "DENY", code: "UNKNOWN_MERCHANT" });
  });

  it("requests approval for unknown merchants when configured", () => {
    const d = evaluate({
      policy: { ...policy, unknownMerchantMode: "require_approval", approvalMode: "unknown_merchants" },
      merchantRule: null,
      merchantId: "mrc_unknown",
    });
    expect(d).toMatchObject({ decision: "REQUIRES_APPROVAL", reason: "UNKNOWN_MERCHANT_APPROVAL" });
  });

  it("allows unknown merchants only under the explicit cap", () => {
    const base = {
      ...policy,
      unknownMerchantMode: "allow_with_cap" as const,
      unknownMerchantCap: 2_000_000n,
    };
    expect(evaluate({ policy: base, merchantRule: null, merchantId: "x", gross: 2_000_000n }).decision).toBe("ALLOW");
    expect(evaluate({ policy: base, merchantRule: null, merchantId: "x", gross: 2_000_001n })).toMatchObject({
      decision: "DENY",
      code: "PER_TX_LIMIT",
    });
  });

  it("enforces total, daily, weekly and monthly budgets", () => {
    expect(evaluate({ usage: { ...usage, totalGrossCommitted: 98_000_000n } })).toMatchObject({
      decision: "DENY",
      code: "TOTAL_BUDGET",
    });
    expect(evaluate({ usage: { ...usage, dayGross: 18_000_000n } })).toMatchObject({
      decision: "DENY",
      code: "DAILY_LIMIT",
    });
    expect(evaluate({ usage: { ...usage, weekGross: 48_000_000n } })).toMatchObject({
      decision: "DENY",
      code: "WEEKLY_LIMIT",
    });
    expect(evaluate({ usage: { ...usage, monthGross: 78_000_000n } })).toMatchObject({
      decision: "DENY",
      code: "MONTHLY_LIMIT",
    });
  });

  it("enforces the per-merchant rolling window", () => {
    const rule: MerchantRule = {
      ...merchant,
      windowLimit: 5_000_000n,
      windowSecs: 86_400,
      windowStart: NOW - 1000,
    };
    expect(evaluate({ merchantRule: rule, usage: { ...usage, merchantWindowGross: 3_000_000n } })).toMatchObject({
      decision: "DENY",
      code: "MERCHANT_WINDOW_LIMIT",
    });
    // An expired window resets the counter.
    expect(
      evaluate({
        merchantRule: { ...rule, windowStart: NOW - 86_400_001 },
        usage: { ...usage, merchantWindowGross: 4_999_999n },
      }).decision,
    ).toBe("ALLOW");
  });

  it("denies when the vault lacks balance for gross plus fee", () => {
    const d = evaluate({ usage: { ...usage, availableDebit: 3_000_000n } });
    expect(d).toMatchObject({ decision: "DENY", code: "INSUFFICIENT_BALANCE" });
  });

  it("denies a revoked agent and an expired policy", () => {
    expect(evaluate({ agentStatus: "revoked" })).toMatchObject({ decision: "DENY", code: "AGENT_REVOKED" });
    expect(evaluate({ policy: { ...policy, expiresAt: NOW } })).toMatchObject({
      decision: "DENY",
      code: "POLICY_EXPIRED",
    });
    expect(evaluate({ policy: { ...policy, status: "paused" } })).toMatchObject({
      decision: "DENY",
      code: "POLICY_PAUSED",
    });
  });

  it("requires and then accepts an exact approval", () => {
    const p: Policy = { ...policy, approvalMode: "all" };
    const first = evaluate({ policy: p });
    expect(first.decision).toBe("REQUIRES_APPROVAL");
    if (first.decision !== "REQUIRES_APPROVAL") throw new Error("expected approval");
    const second = evaluate({ policy: p, approval: approved({ hash: first.approvalHash }) });
    expect(second.decision).toBe("ALLOW");
  });

  it("rejects an approval bound to a different amount, merchant or policy version", () => {
    const p: Policy = { ...policy, approvalMode: "all" };
    expect(evaluate({ policy: p, approval: approved({ gross: 4_000_000n }) }).decision).toBe("REQUIRES_APPROVAL");
    expect(evaluate({ policy: p, approval: approved({ merchantId: "other" }) }).decision).toBe("REQUIRES_APPROVAL");
    expect(evaluate({ policy: p, approval: approved({ policyVersion: 2 }) }).decision).toBe("REQUIRES_APPROVAL");
    expect(evaluate({ policy: p, approval: approved({ paymentId: "pay_2" }) }).decision).toBe("REQUIRES_APPROVAL");
  });

  it("denies an expired approval that otherwise matches", () => {
    const p: Policy = { ...policy, approvalMode: "all" };
    expect(evaluate({ policy: p, approval: approved({ expiresAt: NOW - 1 }) })).toMatchObject({
      decision: "DENY",
      code: "APPROVAL_EXPIRED",
    });
  });

  it("is deterministic", () => {
    const a = evaluate();
    const b = evaluate();
    expect(JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });
});
