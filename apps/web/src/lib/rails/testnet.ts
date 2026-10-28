import {
  agentPay,
  getTransactionStatus,
  getVaultPayment,
  type VaultPaymentView,
} from "@agentspend/near";
import { decryptSecret } from "../crypto";
import { queryOne, setting } from "../db";
import { failedResult, unknownResult, type PaymentRail, type RailExecutionResult, type RailPaymentInput } from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function agentSecret(agentId: string): Promise<string | null> {
  const row = await queryOne<{
    key_ciphertext: string | null;
    key_iv: string | null;
    key_tag: string | null;
  }>("SELECT key_ciphertext, key_iv, key_tag FROM agents WHERE id = ?", [agentId]);
  if (row?.key_ciphertext && row.key_iv && row.key_tag) {
    try {
      return decryptSecret({
        ciphertext: row.key_ciphertext,
        iv: row.key_iv,
        tag: row.key_tag,
      });
    } catch {
      // fall through to the demo setting
    }
  }
  return (await setting(`demo.agent.${agentId}.secret`, "")) || null;
}

function parseEvent(log: string): Record<string, unknown> | null {
  const prefix = "EVENT_JSON:";
  if (!log.startsWith(prefix)) return null;
  try {
    return JSON.parse(log.slice(prefix.length)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Confirm the exact NEP-141 transfer the vault promised: recipient, amount, memo. */
export function verifyMerchantTransferEvent(input: {
  logs: string[];
  payout: string;
  net: bigint;
  paymentId: string;
}): boolean {
  const expectedMemo = `agentspend:v1:${input.paymentId}`;
  for (const log of input.logs) {
    const event = parseEvent(log);
    if (!event || event.standard !== "nep141" || event.event !== "ft_transfer") continue;
    const data = Array.isArray(event.data) ? event.data : [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (
        record.new_owner_id === input.payout &&
        String(record.amount) === input.net.toString() &&
        record.memo === expectedMemo
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The vault's own payment record is the settlement authority: the contract
 * writes `Succeeded` only after the pinned merchant transfer succeeded. The
 * NEP-141 log is additional evidence, but it is not required when the vault
 * record itself matches every expected parameter (for example when the submit
 * response lost the transaction hash during an RPC timeout).
 */
export function verifyVaultSettlement(input: {
  payment: VaultPaymentView;
  payout: string;
  net: bigint;
  gross: bigint;
  paymentId: string;
}): { matches: boolean; settled: boolean; feeCollected: boolean } {
  const matches =
    input.payment.payment_id === input.paymentId &&
    input.payment.payout === input.payout &&
    BigInt(input.payment.net) === input.net &&
    BigInt(input.payment.gross) === input.gross;
  const settled = input.payment.status === "Succeeded" || input.payment.status === "MerchantPaid";
  const feeCollected = input.payment.status === "Succeeded" && input.payment.fee_owed === "0";
  return { matches, settled, feeCollected };
}

async function readVaultPayment(
  vaultAccount: string,
  paymentId: string,
  attempts = 10,
): Promise<VaultPaymentView | null> {
  let last: VaultPaymentView | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await getVaultPayment(vaultAccount, paymentId);
    } catch {
      // keep trying; a transient RPC error is not a settlement verdict
    }
    if (last && (last.status === "Succeeded" || last.status === "Failed")) return last;
    await sleep(700);
  }
  return last;
}

function fromVaultPayment(input: {
  payment: VaultPaymentView | null;
  txHash: string | null;
  logs: string[];
  payout: string;
  net: bigint;
  gross: bigint;
  paymentId: string;
  submitError: string | null;
}): RailExecutionResult {
  const payment = input.payment;
  if (!payment) {
    if (input.submitError) return failedResult(input.submitError, { logs: input.logs });
    return unknownResult(
      "The transaction was submitted but the vault has no payment record yet.",
      input.txHash,
      { logs: input.logs },
    );
  }

  if (payment.status === "Failed") {
    return {
      outcome: "failed",
      txHash: input.txHash,
      chainStatus: "failed",
      settlementRef: null,
      verified: false,
      feeCollected: false,
      error:
        input.submitError ??
        "The vault released the reservation because the merchant transfer failed. No fee was charged.",
      raw: { payment, logs: input.logs },
    };
  }

  if (payment.status === "Reserved") {
    return unknownResult(
      "The vault reserved the payment but settlement is not final yet.",
      input.txHash,
      { payment, logs: input.logs },
    );
  }

  const settlement = verifyVaultSettlement({
    payment,
    payout: input.payout,
    net: input.net,
    gross: input.gross,
    paymentId: input.paymentId,
  });
  if (!settlement.matches) {
    return unknownResult(
      "The vault payment record does not match the expected merchant, amount and reference.",
      input.txHash,
      { payment, logs: input.logs },
    );
  }
  if (!settlement.settled) {
    return unknownResult(
      "The vault has not reached a terminal settlement state.",
      input.txHash,
      { payment, logs: input.logs },
    );
  }

  const transferVerified = verifyMerchantTransferEvent({
    logs: input.logs,
    payout: input.payout,
    net: input.net,
    paymentId: input.paymentId,
  });

  return {
    outcome: "succeeded",
    txHash: input.txHash,
    chainStatus: payment.status === "Succeeded" ? "succeeded" : "merchant_paid_fee_pending",
    settlementRef: input.txHash ?? `vault:${input.paymentId}`,
    verified: true,
    feeCollected: settlement.feeCollected,
    error: null,
    raw: { payment, logs: input.logs, logVerified: transferVerified },
  };
}

/**
 * Live NEAR testnet rail. The agent signs `pay` with its function-call key on
 * the vault account. The contract, not this process, is the final authority on
 * limits. Settlement is only accepted after FINAL execution and an exact
 * NEP-141 merchant-transfer event match.
 */
export const testnetRail: PaymentRail = {
  id: "testnet",
  mode: "live",
  label: "NEAR testnet · on-chain vault",
  async execute(input: RailPaymentInput): Promise<RailExecutionResult> {
    if (input.vault.rail !== "testnet") {
      return failedResult("This vault is not on the live testnet rail.");
    }
    const secretKey = input.agent.secretKey ?? (await agentSecret(input.agent.id));
    if (!secretKey) {
      return failedResult("The agent signing key is unavailable. Nothing was submitted.");
    }

    let send: Awaited<ReturnType<typeof agentPay>> | null = null;
    let submitError: string | null = null;
    try {
      send = await agentPay({
        vaultAccount: input.vault.account_id,
        agentSecretKey: secretKey,
        paymentId: input.paymentId,
        merchantId: input.merchantId,
        gross: input.gross,
        requestExpiryMs: input.requestExpiry,
      });
      if (!send.success) {
        submitError = send.error ?? `transaction failed at ${send.finalExecutionStatus}`;
      }
    } catch (error) {
      submitError = error instanceof Error ? error.message : "transaction submission failed";
    }

    let logs = send?.logs ?? [];
    const txHash = send?.txHash ?? null;

    // A FINAL transaction can still fail in a later receipt. The vault payment
    // record is the authoritative local state; the token log is the proof that
    // the merchant actually received the pinned payout.
    if (txHash && logs.length === 0) {
      try {
        const status = await getTransactionStatus({
          txHash,
          accountId: input.vault.account_id,
        });
        logs = status.logs;
      } catch {
        // settlement verification will fail closed below
      }
    }

    let payment = await readVaultPayment(input.vault.account_id, input.paymentId);
    if (payment && payment.status === "MerchantPaid" && logs.length === 0 && txHash) {
      try {
        const status = await getTransactionStatus({
          txHash,
          accountId: input.vault.account_id,
        });
        logs = status.logs;
      } catch {
        // keep payment; verification below decides
      }
      payment = await readVaultPayment(input.vault.account_id, input.paymentId, 3);
    }

    return fromVaultPayment({
      payment,
      txHash,
      logs,
      payout: input.payoutAccount,
      net: input.net,
      gross: input.gross,
      paymentId: input.paymentId,
      submitError,
    });
  },
};
