import { approvalHash } from "./approval";
import { computeAmounts, formatUsd, type Amounts } from "./money";
import type {
  AgentStatus,
  ApprovalRef,
  MerchantRule,
  Policy,
  PolicyDecision,
  Usage,
} from "./types";

export interface EvaluateInput {
  policy: Policy;
  agentStatus: AgentStatus;
  merchantRule: MerchantRule | null;
  merchantId: string;
  paymentId: string;
  gross: bigint;
  requestExpiry: number;
  now: number;
  usage: Usage;
  approval: ApprovalRef | null;
  /** Merchants for which `approval_mode = selected_merchants` requires approval. */
  selectedMerchantIds: ReadonlySet<string>;
}

function approvalRequirement(
  policy: Policy,
  merchantId: string,
  isUnknown: boolean,
  selectedMerchantIds: ReadonlySet<string>,
): { required: boolean; reason: "APPROVAL_MODE_ALL" | "APPROVAL_SELECTED_MERCHANT" | "UNKNOWN_MERCHANT_APPROVAL" | null } {
  if (policy.approvalMode === "all") return { required: true, reason: "APPROVAL_MODE_ALL" };
  if (policy.approvalMode === "selected_merchants" && selectedMerchantIds.has(merchantId)) {
    return { required: true, reason: "APPROVAL_SELECTED_MERCHANT" };
  }
  if (policy.approvalMode === "unknown_merchants" && isUnknown) {
    return { required: true, reason: "UNKNOWN_MERCHANT_APPROVAL" };
  }
  return { required: false, reason: null };
}

/**
 * Deterministic policy evaluation. No I/O, no clock reads, no randomness.
 * The caller supplies `now`, usage and approval state.
 */
export function evaluatePayment(input: EvaluateInput): PolicyDecision {
  const { policy, agentStatus, merchantRule, merchantId, gross, requestExpiry, now, usage } = input;

  let amounts: Amounts;
  try {
    amounts = computeAmounts(gross);
  } catch (error) {
    return {
      decision: "DENY",
      code: "AMOUNT_INVALID",
      message: error instanceof Error ? error.message : "invalid amount",
    };
  }

  if (policy.status === "revoked") {
    return { decision: "DENY", code: "POLICY_REVOKED", message: "This policy has been revoked.", amounts };
  }
  if (policy.status === "paused") {
    return { decision: "DENY", code: "POLICY_PAUSED", message: "This policy is paused.", amounts };
  }
  if (now < policy.validFrom) {
    return { decision: "DENY", code: "POLICY_NOT_STARTED", message: "This policy is not active yet.", amounts };
  }
  if (now >= policy.expiresAt) {
    return { decision: "DENY", code: "POLICY_EXPIRED", message: "This policy has expired.", amounts };
  }
  if (requestExpiry < now) {
    return { decision: "DENY", code: "REQUEST_EXPIRED", message: "The payment request has expired.", amounts };
  }
  if (agentStatus !== "active") {
    return { decision: "DENY", code: "AGENT_REVOKED", message: "This agent has been revoked.", amounts };
  }

  const isUnknown = merchantRule === null || merchantRule.allowlisted === false;
  if (isUnknown) {
    if (policy.unknownMerchantMode === "deny") {
      return {
        decision: "DENY",
        code: "UNKNOWN_MERCHANT",
        message: "This merchant is not on the allowlist.",
        amounts,
      };
    }
    if (policy.unknownMerchantMode === "allow_with_cap" && policy.unknownMerchantCap <= 0n) {
      return {
        decision: "DENY",
        code: "UNKNOWN_MERCHANT",
        message: "Unknown merchants are capped at zero.",
        amounts,
      };
    }
  } else if (!merchantRule.active) {
    return {
      decision: "DENY",
      code: "MERCHANT_INACTIVE",
      message: "This merchant is disabled in the policy.",
      amounts,
    };
  }

  const effectivePerTx =
    merchantRule && merchantRule.perTxLimit > 0n ? merchantRule.perTxLimit : policy.perTxLimit;
  const unknownCap =
    isUnknown && policy.unknownMerchantMode === "allow_with_cap" ? policy.unknownMerchantCap : null;
  const perTxLimit = unknownCap !== null && unknownCap < effectivePerTx ? unknownCap : effectivePerTx;

  if (gross > perTxLimit) {
    return {
      decision: "DENY",
      code: "PER_TX_LIMIT",
      message: `Amount ${formatUsd(gross)} exceeds the per-transaction limit of ${formatUsd(perTxLimit)}.`,
      amounts,
    };
  }
  if (usage.totalGrossCommitted + gross > policy.totalBudget) {
    return {
      decision: "DENY",
      code: "TOTAL_BUDGET",
      message: "This payment would exceed the total budget.",
      amounts,
    };
  }
  if (policy.dailyLimit > 0n && usage.dayGross + gross > policy.dailyLimit) {
    return {
      decision: "DENY",
      code: "DAILY_LIMIT",
      message: "This payment would exceed today's limit.",
      amounts,
    };
  }
  if (policy.weeklyLimit > 0n && usage.weekGross + gross > policy.weeklyLimit) {
    return {
      decision: "DENY",
      code: "WEEKLY_LIMIT",
      message: "This payment would exceed this week's limit.",
      amounts,
    };
  }
  if (policy.monthlyLimit > 0n && usage.monthGross + gross > policy.monthlyLimit) {
    return {
      decision: "DENY",
      code: "MONTHLY_LIMIT",
      message: "This payment would exceed this month's limit.",
      amounts,
    };
  }

  if (merchantRule && merchantRule.windowLimit > 0n) {
    const windowExpired =
      merchantRule.windowSecs > 0 &&
      now - merchantRule.windowStart >= merchantRule.windowSecs * 1000;
    const spent = windowExpired ? 0n : usage.merchantWindowGross;
    if (spent + gross > merchantRule.windowLimit) {
      return {
        decision: "DENY",
        code: "MERCHANT_WINDOW_LIMIT",
        message: `This payment would exceed the limit for this merchant.`,
        amounts,
      };
    }
  }

  if (usage.availableDebit < amounts.debit) {
    return {
      decision: "DENY",
      code: "INSUFFICIENT_BALANCE",
      message: "The vault does not have enough available balance for this payment plus fees.",
      amounts,
    };
  }

  const hash = approvalHash({
    paymentId: input.paymentId,
    merchantId,
    gross,
    requestExpiry,
    policyVersion: policy.version,
  });

  const requirement = approvalRequirement(policy, merchantId, isUnknown, input.selectedMerchantIds);
  if (requirement.required) {
    const approval = input.approval;
    const matches =
      approval !== null &&
      approval.hash === hash &&
      approval.paymentId === input.paymentId &&
      approval.merchantId === merchantId &&
      approval.gross === gross &&
      approval.requestExpiry === requestExpiry &&
      approval.policyVersion === policy.version;
    if (matches && approval.expiresAt <= now) {
      return {
        decision: "DENY",
        code: "APPROVAL_EXPIRED",
        message: "The approval for this payment has expired.",
        amounts,
      };
    }
    if (!matches) {
      return {
        decision: "REQUIRES_APPROVAL",
        amounts,
        approvalHash: hash,
        reason: requirement.reason!,
        explanation:
          requirement.reason === "UNKNOWN_MERCHANT_APPROVAL"
            ? "This merchant is not on the allowlist and needs your approval."
            : "This payment needs your approval before it can be sent.",
      };
    }
  }

  return {
    decision: "ALLOW",
    amounts,
    approvalHash: requirement.required ? hash : null,
    explanation: `Within policy: ${formatUsd(amounts.gross)} to merchant, ${formatUsd(amounts.userFee)} user fee.`,
  };
}

/** Returns the per-merchant effective limit for display. */
export function effectiveMerchantLimit(policy: Policy, rule: MerchantRule | null): bigint {
  return rule && rule.perTxLimit > 0n ? rule.perTxLimit : policy.perTxLimit;
}
