import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface ApprovalPayload {
  paymentId: string;
  merchantId: string;
  gross: bigint;
  requestExpiry: number;
  policyVersion: number;
}

/**
 * Canonical approval binding. The Rust vault contract computes sha256 over the
 * exact same UTF-8 string, so an approval cannot be replayed for a different
 * payment, merchant, amount, expiry or policy version.
 */
export function canonicalApprovalString(p: ApprovalPayload): string {
  return [
    "agentspend/approval/v1",
    p.paymentId,
    p.merchantId,
    p.gross.toString(),
    p.requestExpiry.toString(),
    p.policyVersion.toString(),
  ].join("|");
}

export function approvalHash(p: ApprovalPayload): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalApprovalString(p))));
}
