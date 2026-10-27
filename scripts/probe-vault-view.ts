import { getVaultState } from "@agentspend/near";
import { vaultById } from "../apps/web/src/lib/platform";
import { closeDb } from "../apps/web/src/lib/db";
async function main() {
  const vault = vaultById("vlt_demo");
  if (!vault) throw new Error("no vault");
  try {
    const state = await getVaultState(vault.account_id);
    console.log(JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("VIEW FAILED", error);
  }
  closeDb();
}
main();
