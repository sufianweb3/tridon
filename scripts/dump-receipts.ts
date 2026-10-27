import { getProvider, TESTNET } from "../packages/near/src/index";

const txHash = process.argv[2] ?? "uCjeZb8xPFzoNVptb2aQazSkrYxPypH7J5NQfPxsXAc";
const senderAccountId = process.argv[3] ?? "as-vault-mvpk1qc46z3b.testnet";

const provider = getProvider(TESTNET);

provider
  .sendJsonRpc("EXPERIMENTAL_tx_status", {
    tx_hash: txHash,
    sender_account_id: senderAccountId,
    wait_until: "FINAL",
  })
  .then((outcome) => {
    const record = outcome as {
      receipts?: Array<{
        receipt_id?: string;
        predecessor_id?: string;
        receiver_id?: string;
        receipt?: {
          Action?: {
            actions?: Array<{
              FunctionCall?: { method_name?: string; gas?: number; deposit?: string };
            }>;
          };
        };
      }>;
    };
    for (const [i, receipt] of (record.receipts ?? []).entries()) {
      console.log(`--- receipt ${i} ${receipt.receipt_id ?? ""}`);
      console.log("from", receipt.predecessor_id, "to", receipt.receiver_id);
      const actions = receipt.receipt?.Action?.actions ?? [];
      for (const action of actions) {
        if (action.FunctionCall) {
          console.log("call", action.FunctionCall.method_name, "gas", action.FunctionCall.gas, "deposit", action.FunctionCall.deposit);
        }
      }
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
