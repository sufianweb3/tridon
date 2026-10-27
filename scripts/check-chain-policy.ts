import { getVaultState, getProvider, TESTNET, publicKeyOf } from "../packages/near/src/index";
import { closeDb, setting } from "../apps/web/src/lib/db";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  const ownerSecret = demoOwnerSecret();
  const ownerAccount = setting("demo.owner.account", "");
  if (!vault || !ownerSecret || !ownerAccount) throw new Error("missing demo config");

  const state = await getVaultState(vault.account_id);
  console.log("chain policy", state.policy);
  console.log("paused", state.config.paused);

  const provider = getProvider(TESTNET);
  const accessKey = await provider.viewAccessKey({
    accountId: ownerAccount,
    publicKey: publicKeyOf(ownerSecret),
    finality: "final",
  });
  console.log("owner access key nonce", accessKey.nonce);

  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
