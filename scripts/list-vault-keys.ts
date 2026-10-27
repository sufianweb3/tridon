import { getProvider, publicKeyOf, TESTNET } from "../packages/near/src/index";
import { closeDb, setting } from "../apps/web/src/lib/db";
import { demoOwnerSecret, vaultById } from "../apps/web/src/lib/platform";

const vault = vaultById("vlt_demo");
const ownerSecret = demoOwnerSecret();

if (!vault) throw new Error("vault missing");
if (!ownerSecret) throw new Error("owner secret missing");

console.log("vault", vault.account_id);
console.log("owner account", setting("demo.owner.account", ""));
console.log("owner public key", publicKeyOf(ownerSecret));

getProvider(TESTNET)
  .viewAccessKeyList({ accountId: vault.account_id, finality: "final" })
  .then((result) => {
    const keys = (result as unknown as {
      keys: Array<{
        public_key: string;
        access_key: { permission: string | { FunctionCall?: unknown }; nonce: number };
      }>;
    }).keys;
    for (const key of keys) {
      const permission =
        typeof key.access_key.permission === "string"
          ? key.access_key.permission
          : `FunctionCall(${JSON.stringify(key.access_key.permission.FunctionCall)})`;
      console.log("key", key.public_key, permission);
    }
    closeDb();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
