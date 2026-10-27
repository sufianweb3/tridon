export type PolicyStatus = "active" | "paused" | "revoked";
export type AgentStatus = "active" | "revoked";

export type ApprovalMode =
  | "all"
  | "none_within_policy"
  | "selected_merchants"
  | "unknown_merchants";

export type UnknownMerchantMode = "deny" | "require_approval" | "allow_with_cap";

export interface Policy {
  id: string;
  status: PolicyStatus;
  /** Caps below are gross amounts. */
  totalBudget: bigint;
  perTxLimit: bigint;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  monthlyLimit: bigint;
  unknownMerchantMode: UnknownMerchantMode;
  unknownMerchantCap: bigint;
  approvalMode: ApprovalMode;
  /** Unix ms. */
  validFrom: number;
  expiresAt: number;
  version: number;
}

export interface MerchantRule {
  merchantId: string;
  payoutAccount: string;
  /** 0 = fall back to the policy per-transaction limit. */
  perTxLimit: bigint;
  /** 0 = disabled. */
  windowLimit: bigint;
  windowSecs: number;
  windowSpent: bigint;
  windowStart: number;
  active: boolean;
  /**
   * false = platform merchant the user has not allowlisted. The payout is still
   * pinned, so this is an "unknown merchant" for policy purposes but never an
   * agent-chosen destination. Defaults to true for older callers.
   */
  allowlisted?: boolean;
}

export interface Usage {
  totalGrossCommitted: bigint;
  dayGross: bigint;
  weekGross: bigint;
  monthGross: bigint;
  /** Committed gross for this merchant in its current window. */
  merchantWindowGross: bigint;
  /** accounted balance minus reserved debit; the most this payment may debit. */
  availableDebit: bigint;
}

export interface ApprovalRef {
  hash: string;
  paymentId: string;
  merchantId: string;
  gross: bigint;
  requestExpiry: number;
  policyVersion: number;
  expiresAt: number;
}

export type DenyCode =
  | "POLICY_PAUSED"
  | "POLICY_REVOKED"
  | "POLICY_NOT_STARTED"
  | "POLICY_EXPIRED"
  | "REQUEST_EXPIRED"
  | "AGENT_REVOKED"
  | "UNKNOWN_MERCHANT"
  | "MERCHANT_INACTIVE"
  | "PER_TX_LIMIT"
  | "TOTAL_BUDGET"
  | "DAILY_LIMIT"
  | "WEEKLY_LIMIT"
  | "MONTHLY_LIMIT"
  | "MERCHANT_WINDOW_LIMIT"
  | "INSUFFICIENT_BALANCE"
  | "AMOUNT_INVALID"
  | "APPROVAL_EXPIRED"
  | "ASSET_NOT_ALLOWED";

export type PolicyDecision =
  | {
      decision: "ALLOW";
      amounts: import("./money").Amounts;
      approvalHash: string | null;
      explanation: string;
    }
  | {
      decision: "REQUIRES_APPROVAL";
      amounts: import("./money").Amounts;
      approvalHash: string;
      reason: "APPROVAL_MODE_ALL" | "APPROVAL_SELECTED_MERCHANT" | "UNKNOWN_MERCHANT_APPROVAL";
      explanation: string;
    }
  | {
      decision: "DENY";
      code: DenyCode;
      message: string;
      amounts?: import("./money").Amounts;
    };
