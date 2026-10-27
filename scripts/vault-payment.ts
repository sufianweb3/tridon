import { getVaultPayment } from "../packages/near/src/index";
import { closeDb } from "../apps/web/src/lib/db";
import { vaultById } from "../apps/web/src/lib/platform";

const ids = process.argv.slice(2);
if (ids.length === 0) ids.push("pay_J6gLHjRyUDUZjKfY", "pay_PvAVMbyhODYNslnQ");

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  if (!vault) throw new Error("vault missing");
  for (const id of ids) {
    try {
      console.log(id, await getVaultPayment(vault.account_id, id));
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
