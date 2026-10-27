import { ftTransferCall, mintTestToken, getVaultState, storageDeposit } from "@agentspend/near";
import { closeDb, setSetting, setting } from "../apps/web/src/lib/db";
import { decryptSecret, type EncryptedSecret } from "../apps/web/src/lib/crypto";
import { syncVaultBalance, vaultById } from "../apps/web/src/lib/platform";

async function main(): Promise<void> {
  const issuer = setting("demo.token.account", "");
  const stored = setting("demo.token.secret", "");
  const vault = vaultById("vlt_demo");
  if (!issuer || !stored || !vault) throw new Error("Demo token/vault is not provisioned.");
  const secret = decryptSecret(JSON.parse(stored) as EncryptedSecret);

  if (setting("demo.funded.vault", "") !== "1") {
    if (setting("demo.registered.issuer", "") !== "1") {
      console.log("Registering the issuer with the token…");
      const registered = await storageDeposit({
        tokenAccount: issuer,
        signerAccount: issuer,
        secretKey: secret,
        accountId: issuer,
      });
      console.log(
        "register:",
        registered.success,
        registered.error ?? registered.finalExecutionStatus,
      );
      if (!registered.success) throw new Error("Issuer registration failed");
      setSetting("demo.registered.issuer", "1");
    }

    console.log("Minting 500 TESTUSD to the issuer…");
    const mint = await mintTestToken({
      tokenAccount: issuer,
      issuerAccount: issuer,
      issuerSecretKey: secret,
      accountId: issuer,
      amount: 500_000_000n,
    });
    console.log("mint:", mint.success, mint.error ?? mint.finalExecutionStatus, mint.txHash);
    if (!mint.success) throw new Error("Mint failed");

    console.log("Funding the vault with ft_transfer_call…");
    const transfer = await ftTransferCall({
      tokenAccount: issuer,
      signerAccount: issuer,
      secretKey: secret,
      receiverId: vault.account_id,
      amount: 500_000_000n,
      msg: "deposit",
    });
    console.log(
      "transfer:",
      transfer.success,
      transfer.error ?? transfer.finalExecutionStatus,
      transfer.txHash,
    );
    console.log("logs:", transfer.logs);
    if (!transfer.success) throw new Error("Vault funding failed");
    setSetting("demo.funded.vault", "1");
  }

  const balance = await syncVaultBalance(vault.id);
  const state = await getVaultState(vault.account_id);
  console.log("accounted balance:", balance.toString());
  console.log("chain state balance:", state.balance.accounted_balance);
  console.log("free balance:", state.balance.free_balance);
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
