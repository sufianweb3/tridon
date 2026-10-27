import crypto from "node:crypto";
import type { PaymentRail, RailExecutionResult, RailPaymentInput } from "./types";

/**
 * Clearly labelled mock rail. Settlement is a local record, not a chain fact.
 * The UI must show "mock rail / backend-enforced" wherever this rail is used.
 * It exists so a wallet-login user can exercise the full product flow without
 * handing the platform a signing key.
 */
export const mockRail: PaymentRail = {
  id: "mock",
  mode: "mock",
  label: "Mock rail · backend-enforced limits",
  async execute(input: RailPaymentInput): Promise<RailExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, 320));

    if (input.simulateFailure || input.merchantId === "merchant-fail") {
      return {
        outcome: "failed",
        txHash: null,
        chainStatus: "mock_declined",
        settlementRef: null,
        verified: false,
        feeCollected: false,
        error: "Mock settlement declined. No fee was charged and the reservation was released.",
        raw: { rail: "mock", declined: true },
      };
    }

    const settlementRef = `mock_settle_${crypto.randomBytes(10).toString("hex")}`;
    return {
      outcome: "succeeded",
      txHash: `mock_tx_${crypto.randomBytes(10).toString("hex")}`,
      chainStatus: "mock_settled",
      settlementRef,
      verified: true,
      feeCollected: true,
      error: null,
      raw: {
        rail: "mock",
        settlementRef,
        note: "Mock settlement. This is not an on-chain transaction.",
        payout: input.payoutAccount,
        net: input.net.toString(),
        gross: input.gross.toString(),
      },
    };
  },
};
