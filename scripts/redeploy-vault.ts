import fs from "node:fs";
import path from "node:path";
import { deployContract, publicKeyOf } from "../packages/near/src/index";
import { closeDb } from "../apps/web/src/lib/db";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

const wasmPath = path.join(
  process.cwd(),
  "contracts",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "agentspend_vault.wasm",
);

async function main(): Promise<void> {
  const vault = vaultById("vlt_demo");
  const ownerSecret = demoOwnerSecret();
  if (!vault) throw new Error("vault missing");
  if (!ownerSecret) throw new Error("owner secret missing");

  const wasm = fs.readFileSync(wasmPath);
  console.log(`Deploying ${wasm.length} bytes to ${vault.account_id} with ${publicKeyOf(ownerSecret).slice(0, 16)}…`);

  const deploy = await deployContract({
    accountId: vault.account_id,
    secretKey: ownerSecret,
    wasm,
  });

  console.log("success:", deploy.success);
  console.log("status:", deploy.finalExecutionStatus);
  console.log("tx:", deploy.txHash);
  console.log("error:", deploy.error);
  if (!deploy.success) {
    console.log(JSON.stringify(deploy.outcome, null, 2).slice(0, 8_000));
    process.exitCode = 1;
  }
  closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
