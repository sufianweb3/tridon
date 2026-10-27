import { getProvider, TESTNET } from "../packages/near/src/index";

const txHash = process.argv[2] ?? "uCjeZb8xPFzoNVptb2aQazSkrYxPypH7J5NQfPxsXAc";
const accountId = process.argv[3] ?? "as-vault-mvpk1qc46z3b.testnet";

const provider = getProvider(TESTNET);

provider
  .viewTransactionStatus({ txHash, accountId, waitUntil: "FINAL" })
  .then((outcome) => {
    const record = outcome as unknown as {
      status?: unknown;
      transaction_outcome?: { outcome?: { logs?: string[]; status?: unknown } };
      receipts_outcome?: Array<{
        id?: string;
        outcome?: { logs?: string[]; status?: unknown; gas_burnt?: number };
      }>;
    };
    console.log("status", JSON.stringify(record.status));
    console.log("tx logs", JSON.stringify(record.transaction_outcome?.outcome?.logs));
    console.log("tx status", JSON.stringify(record.transaction_outcome?.outcome?.status));
    for (const [i, receipt] of (record.receipts_outcome ?? []).entries()) {
      console.log(`--- receipt ${i} ${receipt.id ?? ""}`);
      console.log("status", JSON.stringify(receipt.outcome?.status));
      console.log("gas", receipt.outcome?.gas_burnt);
      console.log("logs", JSON.stringify(receipt.outcome?.logs));
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
