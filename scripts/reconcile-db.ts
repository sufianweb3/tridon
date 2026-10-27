import { reconcilePayment } from "../apps/web/src/lib/payments";
import { closeDb } from "../apps/web/src/lib/db";

const ids = process.argv.slice(2);
if (ids.length === 0) ids.push("pay_J6gLHjRyUDUZjKfY", "pay_PvAVMbyhODYNslnQ");

async function main(): Promise<void> {
  for (const id of ids) {
    try {
      const payment = await reconcilePayment(id);
      console.log(id, {
        status: payment.status,
        chain_status: payment.chain_status,
        settlement_ref: payment.settlement_ref,
        tx_hash: payment.tx_hash,
        error: payment.error,
      });
    } catch (error) {
      console.log(id, "ERROR", error instanceof Error ? error.message : String(error));
    }
  }
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
