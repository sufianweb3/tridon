import { getVaultPayment } from "../packages/near/src/index";
import { getDb } from "../apps/web/src/lib/db";

const paymentId = process.argv[2] ?? "pay_J6gLHjRyUDUZjKfY";
const vault = process.argv[3] ?? "as-vault-mvpk1qc46z3b.testnet";

const db = getDb();
const payment = db
  .prepare("SELECT id, merchant_id, amount_gross, amount_net, user_fee, merchant_fee, policy_id, tx_hash FROM payment_requests WHERE id = ?")
  .get(paymentId) as Record<string, unknown> | undefined;
console.log("payment", payment);

if (payment) {
  const merchant = db
    .prepare("SELECT id, name, payout_account FROM merchants WHERE id = ?")
    .get(payment.merchant_id as string);
  console.log("merchant", merchant);

  const policy = payment.policy_id
    ? db.prepare("SELECT id, vault_id FROM policies WHERE id = ?").get(payment.policy_id as string)
    : null;
  console.log("policy", policy);
}

getVaultPayment(vault, paymentId)
  .then((vp) => console.log("vaultPayment", vp))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
