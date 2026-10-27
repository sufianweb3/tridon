import { getTransactionStatus } from "../packages/near/src/index";

const txHash = process.argv[2] ?? "uCjeZb8xPFzoNVptb2aQazSkrYxPypH7J5NQfPxsXAc";
const accountId = process.argv[3] ?? "as-vault-mvpk1qc46z3b.testnet";

getTransactionStatus({ txHash, accountId })
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
