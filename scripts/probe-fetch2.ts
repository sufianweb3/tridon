import { JsonRpcProvider } from "near-api-js";

async function main() {
  console.log("provider", typeof JsonRpcProvider);
  const accountId = `asprobe${Date.now().toString(36)}.testnet`;
  const response = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: "ed25519:7nRDWKoZpZvz4M46PY3TMpxPo79WYdVWtDn18fbXzjxD",
    }),
  });
  console.log("status", response.status, response.url);
  console.log((await response.text()).slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
