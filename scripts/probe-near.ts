import { createTestnetAccount, generateKey, getAccountBalance, TESTNET } from "@agentspend/near";

async function main() {
  const key = generateKey();
  const accountId = `as-probe-${Date.now().toString(36)}.testnet`;
  console.log("creating", accountId, key.publicKey);
  await createTestnetAccount(accountId, key.publicKey);
  const balance = await getAccountBalance(accountId);
  console.log("balance", balance?.total.toString(), "storage", balance?.storageUsage);
  console.log("rpc", TESTNET.rpcUrl);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
