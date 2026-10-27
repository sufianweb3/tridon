import fs from "node:fs";
import path from "node:path";
import { callMethod, deployContract, getVaultState, publicKeyOf } from "@agentspend/near";
import { closeDb, getDb, setting, setSetting } from "../apps/web/src/lib/db";
import { decryptSecret, type EncryptedSecret } from "../apps/web/src/lib/crypto";
import {
  contractMerchantSeeds,
  contractPolicyJson,
  loadPolicyById,
} from "../apps/web/src/lib/policy-service";
import { appConfig } from "../apps/web/src/lib/config";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

const WASM = path.join(
  process.cwd(),
  "contracts",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "agentspend_vault.wasm",
);

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  const ownerAccount = setting("demo.owner.account", "");
  const stored = setting("demo.vault.temp_secret", "");
  if (!vault || !ownerAccount || !stored) {
    throw new Error("Demo workspace is not provisioned enough for this repair.");
  }
  const tempSecret = decryptSecret(JSON.parse(stored) as EncryptedSecret);

  const already = await getVaultState(vault.account_id).catch(() => null);
  if (already) {
    console.log("Vault is already initialized:", JSON.stringify(already.config));
  } else {
    const wasm = fs.readFileSync(WASM);
    console.log(`Deploying ${wasm.length} bytes to ${vault.account_id}…`);
    const deploy = await deployContract({
      accountId: vault.account_id,
      secretKey: tempSecret,
      wasm,
    });
    console.log("deploy:", deploy.success, deploy.error ?? deploy.finalExecutionStatus, deploy.txHash);
    if (!deploy.success) throw new Error(`Deploy failed: ${deploy.error}`);

    const policy = loadPolicyById("pol_demo");
    if (!policy) throw new Error("Demo policy row missing");
    const ownerSecret = demoOwnerSecret();
    if (!ownerSecret) throw new Error("Demo owner key missing");
    const init = await callMethod({
      accountId: ownerAccount,
      secretKey: ownerSecret,
      contractId: vault.account_id,
      method: "new",
      args: {
        owner: ownerAccount,
        token: vault.token_account,
        fee_account: vault.fee_account,
        user_fee_bps: appConfig.fees.userBps,
        merchant_fee_bps: appConfig.fees.merchantBps,
        policy: contractPolicyJson(policy.row, policy.rules),
        merchants: contractMerchantSeeds(policy.rules),
      },
      deposit: 1_250_000_000_000_000_000_000n,
      gas: 150_000_000_000_000n,
    });
    console.log("init:", init.success, init.error ?? init.finalExecutionStatus, init.txHash);
    console.log("logs:", init.logs);
    if (!init.success) {
      console.log(JSON.stringify(init.outcome, null, 2).slice(0, 8_000));
      throw new Error(`Init failed: ${init.error}`);
    }
    setSetting("demo.vault.initialized", "1");
    setSetting("demo.vault.init_tx", init.txHash);
    getDb()
      .prepare("UPDATE vaults SET deploy_tx = ? WHERE id = ?")
      .run(init.txHash, vault.id);
  }

  const state = await getVaultState(vault.account_id);
  console.log("owner:", state.config.owner);
  console.log("policy version:", state.policy.version);
  console.log("merchant count:", state.merchant_count);
  console.log("temp key:", publicKeyOf(tempSecret).slice(0, 16) + "…");
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
