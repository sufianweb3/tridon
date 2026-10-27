import { callMethod } from "@agentspend/near";
import { closeDb, setting } from "../apps/web/src/lib/db";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

async function main() {
  const ownerAccount = setting("demo.owner.account", "");
  const ownerSecret = demoOwnerSecret();
  const vault = vaultById("vlt_demo");
  if (!ownerAccount || !ownerSecret || !vault) throw new Error("missing demo workspace");
  const result = await callMethod({
    accountId: ownerAccount,
    secretKey: ownerSecret,
    contractId: vault.account_id,
    method: "new",
    args: {
      owner: ownerAccount,
      token: vault.token_account,
      fee_account: vault.fee_account,
      user_fee_bps: 50,
      merchant_fee_bps: 50,
      policy: {
        total_budget: "200000000",
        per_tx_limit: "25000000",
        daily_limit: "0",
        weekly_limit: "0",
        monthly_limit: "0",
        valid_from_ms: 1,
        expires_at_ms: 9999999999999,
        unknown_merchant_mode: "Deny",
        approval_mode: "NoneWithinPolicy",
        approval_selected_merchants: [],
        version: 1,
      },
      merchants: [],
    },
    deposit: 1_250_000_000_000_000_000_000n,
    gas: 150_000_000_000_000n,
  });
  console.log("success:", result.success);
  console.log("error:", result.error);
  console.log("logs:", result.logs);
  console.log("tx:", result.txHash);
  console.log(JSON.stringify(result.outcome, null, 2).slice(0, 4000));
  closeDb();
}
main();
