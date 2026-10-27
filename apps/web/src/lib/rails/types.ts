import type { VaultRow } from "../platform";

export type RailId = "testnet" | "mock";

export interface RailAgent {
  id: string;
  name: string;
  secretKey?: string | null;
}

export interface RailPaymentInput {
  paymentId: string;
  vault: VaultRow;
  merchantId: string;
  payoutAccount: string;
  gross: bigint;
  userFee: bigint;
  merchantFee: bigint;
  net: bigint;
  requestExpiry: number;
  agent: RailAgent;
  simulateFailure: boolean;
}

export type RailOutcome = "succeeded" | "failed" | "unknown";

export interface RailExecutionResult {
  outcome: RailOutcome;
  txHash: string | null;
  chainStatus: string;
  settlementRef: string | null;
  verified: boolean;
  feeCollected: boolean;
  error: string | null;
  raw: unknown;
}

export interface PaymentRail {
  id: RailId;
  mode: "live" | "mock";
  label: string;
  execute(input: RailPaymentInput): Promise<RailExecutionResult>;
}

export function failedResult(error: string, raw: unknown = null): RailExecutionResult {
  return {
    outcome: "failed",
    txHash: null,
    chainStatus: "not_submitted",
    settlementRef: null,
    verified: false,
    feeCollected: false,
    error,
    raw,
  };
}

export function unknownResult(error: string, txHash: string | null, raw: unknown = null): RailExecutionResult {
  return {
    outcome: "unknown",
    txHash,
    chainStatus: "unknown",
    settlementRef: null,
    verified: false,
    feeCollected: false,
    error,
    raw,
  };
}
