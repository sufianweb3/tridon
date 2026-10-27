import { ftBalanceOf } from "../packages/near/src/index";
import { closeDb, getDb } from "../apps/web/src/lib/db";
import { vaultById } from "../apps/web/src/lib/platform";

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  if (!vault) throw new Error("vault missing");

  const merchants = getDb()
    .prepare("SELECT id, name, payout_account FROM merchants ORDER BY id")
    .all() as unknown as Array<{ id: string; name: string; payout_account: string }>;

  const accounts = [
    { label: "vault", account: vault.account_id },
    { label: "fees", account: vault.fee_account },
    ...merchants.map((m) => ({ label: `${m.name} (${m.id})`, account: m.payout_account })),
  ];

  for (const entry of accounts) {
    try {
      const balance = await ftBalanceOf(vault.token_account, entry.account);
      console.log(`${entry.label}\t${entry.account}\t${balance}`);
    } catch (error) {
      console.log(
        `${entry.label}\t${entry.account}\tERROR ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
