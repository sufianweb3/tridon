import { callMethod } from "@agentspend/near";
import { closeDb, getDb, setting } from "../apps/web/src/lib/db";
import {
  contractMerchantSeeds,
  contractPolicyJson,
  loadPolicyById,
} from "../apps/web/src/lib/policy-service";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";
import { appConfig } from "../apps/web/src/lib/config";

async function main(): Promise<void> {
  const ownerAccount = setting("demo.owner.account", "");
  const ownerSecret = demoOwnerSecret();
  const vault = vaultById("vlt_demo");
  const policy = loadPolicyById("pol_demo");
  if (!ownerAccount || !ownerSecret || !vault || !policy) {
    throw new Error("Demo workspace is not provisioned enough for this probe.");
  }
  const args = {
    owner: ownerAccount,
    token: vault.token_account,
    fee_account: vault.fee_account,
    user_fee_bps: appConfig.fees.userBps,
    merchant_fee_bps: appConfig.fees.merchantBps,
    policy: contractPolicyJson(policy.row, policy.rules),
    merchants: contractMerchantSeeds(policy.rules),
  };
  console.log("vault:", vault.account_id);
  console.log("args:", JSON.stringify(args, null, 2));

  const result = await callMethod({
    accountId: ownerAccount,
    secretKey: ownerSecret,
    contractId: vault.account_id,
    method: "new",
    args,
    deposit: 1_250_000_000_000_000_000_000n,
    gas: 150_000_000_000_000n,
  });
  console.log("success:", result.success);
  console.log("finalExecutionStatus:", result.finalExecutionStatus);
  console.log("error:", result.error);
  console.log("logs:", result.logs);
  console.log("tx:", result.txHash);
  console.log("outcome:", JSON.stringify(result.outcome, null, 2).slice(0, 20_000));
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
