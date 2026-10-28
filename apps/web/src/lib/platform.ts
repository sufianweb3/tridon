import fs from "node:fs";
import type { ApprovalMode, UnknownMerchantMode } from "@agentspend/core";
import {
  addFullAccessKey,
  callMethod,
  createTestnetAccount,
  deleteKey,
  deployContract,
  ftBalanceOf,
  ftTransferCall,
  generateKey,
  getAccountBalance,
  getVaultState,
  mintTestToken,
  ownerCall,
  publicKeyOf,
  storageDeposit,
  TESTNET,
} from "@agentspend/near";
import { appConfig } from "./config";
import { decryptSecret, encryptSecret, randomId } from "./crypto";
import { execute, now, query, queryOne, setSetting, setting } from "./db";
import { MERCHANTS, ensureMerchants } from "./seed-data";
import {
  contractMerchantSeeds,
  contractPolicyJson,
  loadPolicyById,
  type PolicyRuleRow,
} from "./policy-service";
import { wasmPaths } from "./paths";

const DAY_MS = 86_400_000;
const DEMO_USER_ID = "usr_demo";
const DEMO_VAULT_ID = "vlt_demo";
const DEMO_POLICY_ID = "pol_demo";
const DEMO_AGENTS = [
  {
    id: "agent-research",
    name: "Research agent",
    description: "Buys datasets, compute and research briefs for a market-research workflow.",
  },
  {
    id: "agent-ops",
    name: "Ops agent",
    description: "Handles small operational purchases and infrastructure renewals.",
  },
];

export interface PolicySpec {
  name: string;
  totalBudget: string;
  perTxLimit: string;
  dailyLimit: string;
  weeklyLimit: string;
  monthlyLimit: string;
  unknownMerchantMode: UnknownMerchantMode;
  unknownMerchantCap: string;
  approvalMode: ApprovalMode;
  rules: Array<{
    merchantId: string;
    allowlisted: boolean;
    perTxLimit: string;
    windowLimit: string;
    windowSecs: number;
    requiresApproval: boolean;
  }>;
}

export const DEFAULT_POLICY_SPEC: PolicySpec = {
  name: "Agent spend policy",
  totalBudget: "200000000",
  perTxLimit: "25000000",
  dailyLimit: "100000000",
  weeklyLimit: "150000000",
  monthlyLimit: "200000000",
  unknownMerchantMode: "deny",
  unknownMerchantCap: "0",
  approvalMode: "selected_merchants",
  rules: [
    {
      merchantId: "merchant-data",
      allowlisted: true,
      perTxLimit: "15000000",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: false,
    },
    {
      merchantId: "merchant-api",
      allowlisted: true,
      perTxLimit: "0",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: false,
    },
    {
      merchantId: "merchant-compute",
      allowlisted: true,
      perTxLimit: "0",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: false,
    },
    {
      merchantId: "merchant-research",
      allowlisted: true,
      perTxLimit: "0",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: true,
    },
    {
      merchantId: "merchant-atlas",
      allowlisted: false,
      perTxLimit: "0",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: false,
    },
    {
      merchantId: "merchant-fail",
      allowlisted: true,
      perTxLimit: "0",
      windowLimit: "0",
      windowSecs: 0,
      requiresApproval: false,
    },
  ],
};

function suffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;
}

function readWasm(path: string): Uint8Array {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing contract wasm at ${path}. Run the Rust build first.`);
  }
  return new Uint8Array(fs.readFileSync(path));
}

async function storeSecret(key: string, plaintext: string): Promise<void> {
  await setSetting(key, JSON.stringify(encryptSecret(plaintext)));
}

async function readSecret(key: string): Promise<string | null> {
  const stored = await setting(key, "");
  if (!stored) return null;
  try {
    return decryptSecret(JSON.parse(stored) as ReturnType<typeof encryptSecret>);
  } catch {
    throw new Error(`Could not decrypt ${key}. The master key may have changed.`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAccount(accountId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const balance = await getAccountBalance(accountId);
    if (balance) return;
    await sleep(500);
  }
  throw new Error(`Testnet account ${accountId} did not become visible`);
}

async function ensureSigningAccount(
  keyPrefix: string,
  accountPrefix: string,
): Promise<{ accountId: string; secretKey: string }> {
  const existingAccount = await setting(`${keyPrefix}.account`, "");
  const existingSecret = await readSecret(`${keyPrefix}.secret`);
  if (existingAccount && existingSecret) {
    return { accountId: existingAccount, secretKey: existingSecret };
  }
  const key = generateKey();
  const accountId = `${accountPrefix}-${suffix()}.testnet`;
  await createTestnetAccount(accountId, key.publicKey);
  await waitForAccount(accountId);
  await setSetting(`${keyPrefix}.account`, accountId);
  await storeSecret(`${keyPrefix}.secret`, key.secretKey);
  return { accountId, secretKey: key.secretKey };
}

async function ensurePlainAccount(keyPrefix: string, accountPrefix: string): Promise<string> {
  const existing = await setting(`${keyPrefix}.account`, "");
  if (existing) return existing;
  const key = generateKey();
  const accountId = `${accountPrefix}-${suffix()}.testnet`;
  await createTestnetAccount(accountId, key.publicKey);
  await waitForAccount(accountId);
  await setSetting(`${keyPrefix}.account`, accountId);
  return accountId;
}

export interface VaultRow {
  id: string;
  user_id: string;
  network: string;
  rail: string;
  account_id: string;
  token_account: string;
  token_symbol: string;
  token_decimals: number;
  fee_account: string;
  balance: string;
  chain_status: string;
  deploy_tx: string | null;
  created_at: number;
}

export async function vaultById(vaultId: string): Promise<VaultRow | null> {
  return queryOne<VaultRow>("SELECT * FROM vaults WHERE id = ?", [vaultId]);
}

export async function vaultForUser(userId: string): Promise<VaultRow | null> {
  return queryOne<VaultRow>(
    "SELECT * FROM vaults WHERE user_id = ? ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
}

export async function vaultForAgent(agentId: string): Promise<VaultRow | null> {
  return queryOne<VaultRow>(
    `SELECT v.* FROM vaults v JOIN agents a ON a.vault_id = v.id WHERE a.id = ? LIMIT 1`,
    [agentId],
  );
}

async function upsertUser(id: string, wallet: string, displayName: string, role: string): Promise<void> {
  await execute(
    `INSERT INTO users (id, wallet, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET wallet = excluded.wallet, display_name = excluded.display_name, role = excluded.role`,
    [id, wallet, displayName, role, now()],
  );
}

async function insertVault(input: {
  id: string;
  userId: string;
  rail: "testnet" | "mock";
  accountId: string;
  tokenAccount: string;
  feeAccount: string;
  balance: string;
}): Promise<void> {
  await execute(
    `INSERT INTO vaults (id, user_id, network, rail, account_id, token_account, token_symbol,
      token_decimals, fee_account, balance, chain_status, created_at)
     VALUES (?, ?, 'testnet', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       rail = excluded.rail, account_id = excluded.account_id, token_account = excluded.token_account,
       fee_account = excluded.fee_account`,
    [
      input.id,
      input.userId,
      input.rail,
      input.accountId,
      input.tokenAccount,
      appConfig.token.symbol,
      appConfig.token.decimals,
      input.feeAccount,
      input.balance,
      input.rail === "mock" ? "mock" : "ready",
      now(),
    ],
  );
}

export async function insertPolicyWithRules(input: {
  id: string;
  userId: string;
  vaultId: string;
  spec: PolicySpec;
  validFrom?: number;
  expiresAt?: number;
}): Promise<void> {
  const timestamp = now();
  const validFrom = input.validFrom ?? timestamp - 60_000;
  const expiresAt = input.expiresAt ?? timestamp + 90 * DAY_MS;
  await execute(
    `INSERT INTO policies (id, user_id, agent_id, vault_id, name, status, total_budget,
      per_tx_limit, daily_limit, weekly_limit, monthly_limit, unknown_merchant_mode,
      unknown_merchant_cap, approval_mode, valid_from, expires_at, version, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, total_budget = excluded.total_budget, per_tx_limit = excluded.per_tx_limit,
       daily_limit = excluded.daily_limit, weekly_limit = excluded.weekly_limit,
       monthly_limit = excluded.monthly_limit, unknown_merchant_mode = excluded.unknown_merchant_mode,
       unknown_merchant_cap = excluded.unknown_merchant_cap, approval_mode = excluded.approval_mode,
       valid_from = excluded.valid_from, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    [
      input.id,
      input.userId,
      input.vaultId,
      input.spec.name,
      input.spec.totalBudget,
      input.spec.perTxLimit,
      input.spec.dailyLimit,
      input.spec.weeklyLimit,
      input.spec.monthlyLimit,
      input.spec.unknownMerchantMode,
      input.spec.unknownMerchantCap,
      input.spec.approvalMode,
      validFrom,
      expiresAt,
      timestamp,
      timestamp,
    ],
  );

  for (const rule of input.spec.rules) {
    const merchant = await queryOne<{ payout_account: string }>(
      "SELECT payout_account FROM merchants WHERE id = ?",
      [rule.merchantId],
    );
    if (!merchant) continue;
    await execute(
      `INSERT INTO policy_merchant_rules (id, policy_id, merchant_id, payout_account,
        per_tx_limit, window_limit, window_secs, allowlisted, requires_approval, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(policy_id, merchant_id) DO UPDATE SET
         payout_account = excluded.payout_account, per_tx_limit = excluded.per_tx_limit,
         window_limit = excluded.window_limit, window_secs = excluded.window_secs,
         allowlisted = excluded.allowlisted, requires_approval = excluded.requires_approval,
         active = 1`,
      [
        `rule_${input.id}_${rule.merchantId}`,
        input.id,
        rule.merchantId,
        merchant.payout_account,
        rule.perTxLimit,
        rule.windowLimit,
        rule.windowSecs,
        rule.allowlisted ? 1 : 0,
        rule.requiresApproval ? 1 : 0,
        timestamp,
      ],
    );
  }
}

async function insertAgent(input: {
  id: string;
  userId: string;
  vaultId: string;
  name: string;
  description: string;
  publicKey?: string | null;
  encryptedKey?: { ciphertext: string; iv: string; tag: string } | null;
}): Promise<void> {
  await execute(
    `INSERT INTO agents (id, user_id, vault_id, name, description, status, public_key,
      key_ciphertext, key_iv, key_tag, allowance_yocto, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description`,
    [
      input.id,
      input.userId,
      input.vaultId,
      input.name,
      input.description,
      input.publicKey ?? null,
      input.encryptedKey?.ciphertext ?? null,
      input.encryptedKey?.iv ?? null,
      input.encryptedKey?.tag ?? null,
      "500000000000000000000000",
      now(),
    ],
  );
}

async function updateMerchantPayouts(payouts: Record<string, string>): Promise<void> {
  for (const [merchantId, accountId] of Object.entries(payouts)) {
    await execute("UPDATE merchants SET payout_account = ? WHERE id = ?", [accountId, merchantId]);
  }
}

export interface DemoWorkspace {
  userId: string;
  vaultId: string;
  vaultAccount: string;
  tokenAccount: string;
  ownerAccount: string;
  resumed: boolean;
}

/**
 * Testnet-only demo infrastructure. This is the one workspace where the server
 * holds signing keys: a labelled demo owner account, a token issuer, and the
 * agent function-call keys. It never touches a real user's wallet key. Wallet
 * users are provisioned on the mock rail instead.
 */
export async function ensureDemoWorkspace(): Promise<DemoWorkspace> {
  const existingVaultId = await setting("demo.vault_id", "");
  const existingUserId = await setting("demo.user_id", "");
  const allAgentsAdded = (
    await Promise.all(
      DEMO_AGENTS.map(async (agent) => (await setting(`demo.agent.${agent.id}.added`, "")) === "1"),
    )
  ).every(Boolean);
  if (
    existingVaultId &&
    existingUserId &&
    (await setting("demo.vault.initialized", "")) === "1" &&
    (await setting("demo.minted", "")) === "1" &&
    (await setting("demo.vault.temp_deleted", "")) === "1" &&
    allAgentsAdded
  ) {
    const vault = await vaultById(existingVaultId);
    if (vault) {
      await ensureDemoAgents(vault);
      return {
        userId: existingUserId,
        vaultId: existingVaultId,
        vaultAccount: vault.account_id,
        tokenAccount: vault.token_account,
        ownerAccount: await setting("demo.owner.account", ""),
        resumed: true,
      };
    }
  }

  await ensureMerchants();

  const owner = await ensureSigningAccount("demo.owner", "as-owner");
  const issuer = await ensureSigningAccount("demo.token", "as-testusd");
  const feeAccount = await ensurePlainAccount("demo.fee", "as-fees");

  const payouts: Record<string, string> = {};
  for (const merchant of MERCHANTS) {
    payouts[merchant.id] = await ensurePlainAccount(
      `demo.payout.${merchant.id}`,
      `as-pay-${merchant.slug}`,
    );
  }
  await updateMerchantPayouts(payouts);

  // Token contract -----------------------------------------------------------
  if ((await setting("demo.token.deployed", "")) !== "1") {
    const wasm = readWasm(wasmPaths.token);
    const deploy = await deployContract({
      accountId: issuer.accountId,
      secretKey: issuer.secretKey,
      wasm,
    });
    if (!deploy.success) {
      throw new Error(`Token deploy failed: ${deploy.error ?? deploy.finalExecutionStatus}`);
    }
    const init = await callMethod({
      accountId: issuer.accountId,
      secretKey: issuer.secretKey,
      contractId: issuer.accountId,
      method: "new",
      args: {
        owner: issuer.accountId,
        name: appConfig.token.name,
        symbol: appConfig.token.symbol,
        decimals: appConfig.token.decimals,
        icon: null,
      },
      gas: 60_000_000_000_000n,
    });
    if (!init.success) throw new Error(`Token init failed: ${init.error ?? init.finalExecutionStatus}`);
    await setSetting("demo.token.deployed", "1");
  }

  // Vault account + contract -------------------------------------------------
  let vaultAccount = await setting("demo.vault.account", "");
  if (!vaultAccount) {
    const temp = generateKey();
    vaultAccount = `as-vault-${suffix()}.testnet`;
    await createTestnetAccount(vaultAccount, temp.publicKey);
    await waitForAccount(vaultAccount);
    await setSetting("demo.vault.account", vaultAccount);
    await storeSecret("demo.vault.temp_secret", temp.secretKey);
  }

  if ((await setting("demo.vault.deployed", "")) !== "1") {
    const tempSecret = await readSecret("demo.vault.temp_secret");
    if (!tempSecret) throw new Error("Missing temporary vault deploy key");
    const deploy = await deployContract({
      accountId: vaultAccount,
      secretKey: tempSecret,
      wasm: readWasm(wasmPaths.vault),
    });
    if (!deploy.success) {
      throw new Error(`Vault deploy failed: ${deploy.error ?? deploy.finalExecutionStatus}`);
    }
    await setSetting("demo.vault.deployed", "1");
  }

  if ((await setting("demo.vault.owner_key", "")) !== "1") {
    const tempSecret = await readSecret("demo.vault.temp_secret");
    if (!tempSecret) throw new Error("Missing temporary vault deploy key");
    const add = await addFullAccessKey({
      accountId: vaultAccount,
      secretKey: tempSecret,
      publicKey: publicKeyOf(owner.secretKey),
    });
    if (!add.success) throw new Error(`Adding owner key failed: ${add.error ?? add.finalExecutionStatus}`);
    await setSetting("demo.vault.owner_key", "1");
  }

  // DB rows needed before contract init (policy JSON is read back from them).
  await upsertUser(DEMO_USER_ID, owner.accountId, "Demo workspace", "demo");
  const vaultId = DEMO_VAULT_ID;
  await insertVault({
    id: vaultId,
    userId: DEMO_USER_ID,
    rail: "testnet",
    accountId: vaultAccount,
    tokenAccount: issuer.accountId,
    feeAccount,
    balance: "0",
  });
  await setSetting("demo.user_id", DEMO_USER_ID);
  await setSetting("demo.vault_id", vaultId);

  const policy = await loadPolicyById(DEMO_POLICY_ID);
  if (!policy) {
    await insertPolicyWithRules({
      id: DEMO_POLICY_ID,
      userId: DEMO_USER_ID,
      vaultId,
      spec: DEFAULT_POLICY_SPEC,
    });
  }

  if ((await setting("demo.vault.initialized", "")) !== "1") {
    const loaded = await loadPolicyById(DEMO_POLICY_ID);
    if (!loaded) throw new Error("Demo policy row missing");
    const init = await callMethod({
      accountId: owner.accountId,
      secretKey: owner.secretKey,
      contractId: vaultAccount,
      method: "new",
      args: {
        owner: owner.accountId,
        token: issuer.accountId,
        fee_account: feeAccount,
        user_fee_bps: appConfig.fees.userBps,
        merchant_fee_bps: appConfig.fees.merchantBps,
        policy: contractPolicyJson(loaded.row, loaded.rules),
        merchants: contractMerchantSeeds(loaded.rules),
      },
      deposit: 1_250_000_000_000_000_000_000n,
      gas: 150_000_000_000_000n,
    });
    if (!init.success) {
      throw new Error(`Vault init failed: ${init.error ?? init.finalExecutionStatus}`);
    }
    await setSetting("demo.vault.initialized", "1");
    await setSetting("demo.vault.init_tx", init.txHash);
    await execute("UPDATE vaults SET deploy_tx = ? WHERE id = ?", [init.txHash, vaultId]);
  }

  if ((await setting("demo.vault.temp_deleted", "")) !== "1") {
    const tempSecret = await readSecret("demo.vault.temp_secret");
    if (tempSecret) {
      const tempPublic = publicKeyOf(tempSecret);
      const deleted = await deleteKey({
        accountId: vaultAccount,
        secretKey: tempSecret,
        publicKey: tempPublic,
      });
      if (!deleted.success) {
        throw new Error(`Deleting temporary vault key failed: ${deleted.error ?? deleted.finalExecutionStatus}`);
      }
    }
    await setSetting("demo.vault.temp_deleted", "1");
    await setSetting("demo.vault.temp_secret", "");
  }

  // Token storage registration + funding ------------------------------------
  if ((await setting("demo.registered.vault", "")) !== "1") {
    const registered = await storageDeposit({
      tokenAccount: issuer.accountId,
      signerAccount: issuer.accountId,
      secretKey: issuer.secretKey,
      accountId: vaultAccount,
    });
    if (!registered.success) {
      throw new Error(`Vault token registration failed: ${registered.error ?? registered.finalExecutionStatus}`);
    }
    await setSetting("demo.registered.vault", "1");
  }

  for (const merchant of MERCHANTS) {
    // Flaky Fulfillment is intentionally not registered: its settlement must
    // fail at the token contract so the failure path is real, not simulated.
    if (merchant.id === "merchant-fail") continue;
    const key = `demo.registered.${merchant.id}`;
    if ((await setting(key, "")) === "1") continue;
    const registered = await storageDeposit({
      tokenAccount: issuer.accountId,
      signerAccount: issuer.accountId,
      secretKey: issuer.secretKey,
      accountId: payouts[merchant.id]!,
    });
    if (!registered.success) {
      throw new Error(
        `Merchant ${merchant.id} token registration failed: ${registered.error ?? registered.finalExecutionStatus}`,
      );
    }
    await setSetting(key, "1");
  }

  if ((await setting("demo.registered.fee", "")) !== "1") {
    const registered = await storageDeposit({
      tokenAccount: issuer.accountId,
      signerAccount: issuer.accountId,
      secretKey: issuer.secretKey,
      accountId: feeAccount,
    });
    if (!registered.success) {
      throw new Error(`Fee account token registration failed: ${registered.error ?? registered.finalExecutionStatus}`);
    }
    await setSetting("demo.registered.fee", "1");
  }

  if ((await setting("demo.registered.issuer", "")) !== "1") {
    const registered = await storageDeposit({
      tokenAccount: issuer.accountId,
      signerAccount: issuer.accountId,
      secretKey: issuer.secretKey,
      accountId: issuer.accountId,
    });
    if (!registered.success) {
      throw new Error(
        `Issuer token registration failed: ${registered.error ?? registered.finalExecutionStatus}`,
      );
    }
    await setSetting("demo.registered.issuer", "1");
  }

  if ((await setting("demo.minted", "")) !== "1") {
    const mint = await mintTestToken({
      tokenAccount: issuer.accountId,
      issuerAccount: issuer.accountId,
      issuerSecretKey: issuer.secretKey,
      accountId: issuer.accountId,
      amount: 500_000_000n,
    });
    if (!mint.success) throw new Error(`Mint failed: ${mint.error ?? mint.finalExecutionStatus}`);
    await setSetting("demo.minted", "1");
  }

  // A direct mint credits the token balance but does not run the vault's
  // ft_on_transfer hook, so the vault would hold tokens it has not accounted
  // for. Fund it with ft_transfer_call and msg = "deposit" instead.
  if ((await setting("demo.funded.vault", "")) !== "1") {
    const funded = await ftTransferCall({
      tokenAccount: issuer.accountId,
      signerAccount: issuer.accountId,
      secretKey: issuer.secretKey,
      receiverId: vaultAccount,
      amount: 500_000_000n,
      msg: "deposit",
    });
    if (!funded.success) {
      throw new Error(`Vault funding failed: ${funded.error ?? funded.finalExecutionStatus}`);
    }
    await setSetting("demo.funded.vault", "1");
  }

  const vault = await vaultById(vaultId);
  if (!vault) throw new Error("Demo vault row missing");
  await ensureDemoAgents(vault);

  return {
    userId: DEMO_USER_ID,
    vaultId,
    vaultAccount,
    tokenAccount: issuer.accountId,
    ownerAccount: owner.accountId,
    resumed: false,
  };
}

async function ensureDemoAgents(vault: VaultRow): Promise<void> {
  for (const definition of DEMO_AGENTS) {
    let row = await queryOne<{
      id: string;
      public_key: string | null;
      key_ciphertext: string | null;
    }>("SELECT * FROM agents WHERE id = ?", [definition.id]);

    if (!row) {
      const key = generateKey();
      await insertAgent({
        id: definition.id,
        userId: DEMO_USER_ID,
        vaultId: vault.id,
        name: definition.name,
        description: definition.description,
        publicKey: key.publicKey,
        encryptedKey: encryptSecret(key.secretKey),
      });
      await storeSecret(`demo.agent.${definition.id}.secret`, key.secretKey);
      row = await queryOne<typeof row>("SELECT * FROM agents WHERE id = ?", [definition.id]);
    }

    const flag = `demo.agent.${definition.id}.added`;
    if ((await setting(flag, "")) === "1") continue;
    const publicKey = row?.public_key;
    if (!publicKey) throw new Error(`Agent ${definition.id} has no public key`);

    const ownerAccount = await setting("demo.owner.account", "");
    const ownerSecret = await readSecret("demo.owner.secret");
    if (!ownerAccount || !ownerSecret) throw new Error("Missing demo owner key");

    const result = await ownerCall({
      vaultAccount: vault.account_id,
      ownerAccount,
      ownerSecretKey: ownerSecret,
      method: "add_agent",
      args: { agent_id: definition.id, public_key: publicKey },
    });
    if (!result.success) {
      throw new Error(
        `Adding agent ${definition.id} failed: ${result.error ?? result.finalExecutionStatus}`,
      );
    }
    await setSetting(flag, "1");
  }
}

/** Read the vault's accounted balance from the chain and mirror it into Postgres. */
export async function syncVaultBalance(vaultId: string): Promise<bigint> {
  const vault = await vaultById(vaultId);
  if (!vault) return 0n;
  if (vault.rail !== "testnet") return BigInt(vault.balance);
  try {
    const state = await getVaultState(vault.account_id);
    const balance = BigInt(state.balance.accounted_balance);
    await execute("UPDATE vaults SET balance = ?, chain_status = 'ready' WHERE id = ?", [
      balance.toString(),
      vaultId,
    ]);
    return balance;
  } catch (error) {
    await execute("UPDATE vaults SET chain_status = 'unreachable' WHERE id = ?", [vaultId]);
    console.warn(`[vault] balance sync failed for ${vaultId}:`, (error as Error).message);
    return BigInt(vault.balance);
  }
}

export async function vaultTokenBalance(vault: VaultRow): Promise<bigint | null> {
  if (vault.rail !== "testnet") return BigInt(vault.balance);
  try {
    return await ftBalanceOf(vault.token_account, vault.account_id);
  } catch {
    return null;
  }
}

export async function syncPolicyToVault(input: {
  policyId: string;
  removedMerchantIds?: string[];
}): Promise<{ txHash: string | null; version: number }> {
  const policy = await loadPolicyById(input.policyId);
  if (!policy) throw new Error("policy not found");
  const vault = policy.row.vault_id ? await vaultById(policy.row.vault_id) : null;
  if (!vault) throw new Error("vault not found");
  if (vault.rail !== "testnet") {
    const version = policy.row.version + 1;
    await execute("UPDATE policies SET version = ?, updated_at = ? WHERE id = ?", [
      version,
      now(),
      policy.row.id,
    ]);
    return { txHash: null, version };
  }

  const ownerAccount = await setting("demo.owner.account", "");
  const ownerSecret = await readSecret("demo.owner.secret");
  if (!ownerAccount || !ownerSecret) {
    throw new Error("This vault is not controlled by the demo signer.");
  }

  const setResult = await ownerCall({
    vaultAccount: vault.account_id,
    ownerAccount,
    ownerSecretKey: ownerSecret,
    method: "set_policy",
    args: { policy: contractPolicyJson(policy.row, policy.rules) },
  });
  if (!setResult.success) {
    throw new Error(`set_policy failed: ${setResult.error ?? setResult.finalExecutionStatus}`);
  }

  for (const rule of policy.rules.filter((item) => item.active === 1)) {
    const result = await ownerCall({
      vaultAccount: vault.account_id,
      ownerAccount,
      ownerSecretKey: ownerSecret,
      method: "add_merchant",
      args: {
        merchant_id: rule.merchant_id,
        payout: rule.payout_account,
        per_tx_limit: rule.per_tx_limit,
        window_limit: rule.window_limit,
        window_secs: rule.window_secs,
        allowlisted: rule.allowlisted === 1,
      },
    });
    if (!result.success) {
      throw new Error(
        `add_merchant ${rule.merchant_id} failed: ${result.error ?? result.finalExecutionStatus}`,
      );
    }
  }

  for (const merchantId of input.removedMerchantIds ?? []) {
    const result = await ownerCall({
      vaultAccount: vault.account_id,
      ownerAccount,
      ownerSecretKey: ownerSecret,
      method: "remove_merchant",
      args: { merchant_id: merchantId },
    });
    if (!result.success) {
      throw new Error(
        `remove_merchant ${merchantId} failed: ${result.error ?? result.finalExecutionStatus}`,
      );
    }
  }

  const onChain = await getVaultState(vault.account_id);
  const version = onChain.policy.version;
  await execute("UPDATE policies SET version = ?, updated_at = ? WHERE id = ?", [
    version,
    now(),
    policy.row.id,
  ]);
  return { txHash: setResult.txHash, version };
}

export async function pauseVaultPolicy(policyId: string, paused: boolean): Promise<void> {
  const policy = await loadPolicyById(policyId);
  if (!policy) throw new Error("policy not found");
  const vault = policy.row.vault_id ? await vaultById(policy.row.vault_id) : null;
  if (!vault) throw new Error("vault not found");
  if (vault.rail !== "testnet") return;
  const ownerAccount = await setting("demo.owner.account", "");
  const ownerSecret = await readSecret("demo.owner.secret");
  if (!ownerAccount || !ownerSecret) throw new Error("Demo owner key missing");
  const result = await ownerCall({
    vaultAccount: vault.account_id,
    ownerAccount,
    ownerSecretKey: ownerSecret,
    method: paused ? "pause" : "unpause",
  });
  if (!result.success) {
    throw new Error(`vault ${paused ? "pause" : "unpause"} failed: ${result.error ?? result.finalExecutionStatus}`);
  }
}

export async function approveOnVault(input: {
  policyId: string;
  paymentId: string;
  merchantId: string;
  gross: string;
  requestExpiry: number;
  approvalExpiry: number;
}): Promise<string | null> {
  const policy = await loadPolicyById(input.policyId);
  if (!policy) throw new Error("policy not found");
  const vault = policy.row.vault_id ? await vaultById(policy.row.vault_id) : null;
  if (!vault || vault.rail !== "testnet") return null;
  const ownerAccount = await setting("demo.owner.account", "");
  const ownerSecret = await readSecret("demo.owner.secret");
  if (!ownerAccount || !ownerSecret) throw new Error("Demo owner key missing");
  const result = await ownerCall({
    vaultAccount: vault.account_id,
    ownerAccount,
    ownerSecretKey: ownerSecret,
    method: "approve",
    args: {
      payment_id: input.paymentId,
      merchant_id: input.merchantId,
      gross: input.gross,
      request_expiry_ms: input.requestExpiry,
      approval_expiry_ms: input.approvalExpiry,
    },
  });
  if (!result.success) {
    throw new Error(`approve failed: ${result.error ?? result.finalExecutionStatus}`);
  }
  return result.txHash;
}

/** Add a newly created agent's function-call key to a live vault. */
export async function addAgentKeyToVault(input: {
  vault: VaultRow;
  agentId: string;
  publicKey: string;
}): Promise<void> {
  if (input.vault.rail !== "testnet") return;
  const ownerAccount = await setting("demo.owner.account", "");
  const ownerSecret = await readSecret("demo.owner.secret");
  if (!ownerAccount || !ownerSecret) {
    throw new Error(
      "This vault is not controlled by the demo signer, so a new on-chain agent key cannot be added.",
    );
  }
  const result = await ownerCall({
    vaultAccount: input.vault.account_id,
    ownerAccount,
    ownerSecretKey: ownerSecret,
    method: "add_agent",
    args: { agent_id: input.agentId, public_key: input.publicKey },
  });
  if (!result.success) {
    throw new Error(`add_agent failed: ${result.error ?? result.finalExecutionStatus}`);
  }
}

export async function revokeAgentOnVault(agentId: string): Promise<void> {
  const agent = await queryOne<{
    id: string;
    vault_account: string;
    rail: string;
    status: string;
  }>(
    "SELECT a.*, v.account_id AS vault_account, v.rail FROM agents a JOIN vaults v ON v.id = a.vault_id WHERE a.id = ?",
    [agentId],
  );
  if (!agent) throw new Error("agent not found");
  if (agent.rail !== "testnet") return;
  const ownerAccount = await setting("demo.owner.account", "");
  const ownerSecret = await readSecret("demo.owner.secret");
  if (!ownerAccount || !ownerSecret) throw new Error("Demo owner key missing");
  const result = await ownerCall({
    vaultAccount: agent.vault_account,
    ownerAccount,
    ownerSecretKey: ownerSecret,
    method: "revoke_agent",
    args: { agent_id: agent.id },
  });
  if (!result.success) {
    throw new Error(`revoke_agent failed: ${result.error ?? result.finalExecutionStatus}`);
  }
}

/** Wallet users get a clearly labelled mock vault. No keys, no chain. */
export async function ensureMockWorkspace(userId: string, wallet: string): Promise<VaultRow> {
  const existing = await vaultForUser(userId);
  if (existing) return existing;
  await ensureMerchants();
  const token = randomId("vlt_");
  const vaultId = `vlt_mock_${token.slice(4)}`;
  await insertVault({
    id: vaultId,
    userId,
    rail: "mock",
    accountId: `mock:vault:${token}`,
    tokenAccount: "mock:TESTUSD",
    feeAccount: `mock:fees:${token}`,
    balance: "500000000",
  });
  await insertPolicyWithRules({
    id: `pol_${token.slice(4)}`,
    userId,
    vaultId,
    spec: DEFAULT_POLICY_SPEC,
  });
  await insertAgent({
    id: `agent_${token.slice(4)}`,
    userId,
    vaultId,
    name: "First agent",
    description: `Created for ${wallet} on the mock rail. Add a real agent key to call the agent API.`,
  });
  const vault = await vaultById(vaultId);
  if (!vault) throw new Error("mock vault creation failed");
  return vault;
}

export function testnetStatus(): { network: string; rpc: string; token: string; label: string } {
  return {
    network: TESTNET.networkId,
    rpc: TESTNET.rpcUrl,
    token: appConfig.token.label,
    label: "NEAR testnet · live vault rail",
  };
}

export async function demoOwnerSecret(): Promise<string | null> {
  return readSecret("demo.owner.secret");
}

export function policyRulePayout(rule: PolicyRuleRow): string {
  return rule.payout_account;
}
