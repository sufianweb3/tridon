import { callMethod, getVaultPayment } from "../packages/near/src/index";
import { closeDb, setting } from "../apps/web/src/lib/db";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  const ownerSecret = demoOwnerSecret();
  const ownerAccount = setting("demo.owner.account", "");
  const paymentId = process.argv[2] ?? "pay_J6gLHjRyUDUZjKfY";
  const merchantPaid = (process.argv[3] ?? "true") === "true";

  if (!vault) throw new Error("vault missing");
  if (!ownerSecret) throw new Error("owner secret missing");
  if (!ownerAccount) throw new Error("owner account missing");

  console.log("before", await getVaultPayment(vault.account_id, paymentId));

  const result = await callMethod({
    accountId: ownerAccount,
    secretKey: ownerSecret,
    contractId: vault.account_id,
    method: "reconcile_payment",
    args: { payment_id: paymentId, merchant_paid: merchantPaid },
    gas: 200_000_000_000_000n,
  });

  console.log("success:", result.success);
  console.log("status:", result.finalExecutionStatus);
  console.log("tx:", result.txHash);
  console.log("error:", result.error);
  console.log("logs:", result.logs);

  const after = await getVaultPayment(vault.account_id, paymentId);
  console.log("after", after);
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
