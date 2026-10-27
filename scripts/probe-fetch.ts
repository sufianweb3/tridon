import { TESTNET } from "@agentspend/near";

async function main() {
  const accountId = `asprobe${Date.now().toString(36)}.testnet`;
  console.log("helper", TESTNET.helperUrl, "account", accountId);
  const response = await fetch(TESTNET.helperUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: "ed25519:7nRDWKoZpZvz4M46PY3TMpxPo79WYdVWtDn18fbXzjxD",
    }),
  });
  console.log("status", response.status);
  console.log("location", response.headers.get("location"));
  console.log("url", response.url);
  console.log((await response.text()).slice(0, 500));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
