/**
 * Thin, typed NEAR testnet adapter.
 *
 * Everything here is testnet-only. The adapter deliberately exposes only the
 * operations AgentSpend needs: create a testnet account through the official
 * helper, deploy wasm, call a method, read a view, and read authoritative
 * transaction status at FINAL.
 */
import {
  Account,
  JsonRpcProvider,
  KeyPair,
  PublicKey,
  actions as nearActions,
  type Action,
  type KeyPairString,
} from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";

export interface NearConfig {
  rpcUrl: string;
  helperUrl: string;
  networkId: "testnet";
}

export const TESTNET: NearConfig = {
  rpcUrl: process.env.AGENTSPEND_NEAR_RPC ?? "https://rpc.testnet.near.org",
  helperUrl: process.env.AGENTSPEND_NEAR_HELPER ?? "https://helper.testnet.near.org",
  networkId: "testnet",
};

export const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = 1n;
export const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR

let provider: JsonRpcProvider | undefined;

export function getProvider(config: NearConfig = TESTNET): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider({ url: config.rpcUrl });
  }
  return provider;
}

export interface GeneratedKey {
  secretKey: string;
  publicKey: string;
}

export function generateKey(): GeneratedKey {
  const pair = KeyPair.fromRandom("ed25519");
  return {
    secretKey: pair.toString(),
    publicKey: pair.getPublicKey().toString(),
  };
}

export function publicKeyOf(secretKey: string): string {
  return KeyPair.fromString(secretKey as KeyPairString).getPublicKey().toString();
}

export interface RpcErrorShape {
  name?: string;
  cause?: { name?: string; info?: unknown };
  message?: string;
}

function describeRpcError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const candidate = error as RpcErrorShape;
  const info = candidate.cause?.info;
  if (info && typeof info === "object") {
    const record = info as Record<string, unknown>;
    if (typeof record.error_message === "string") return record.error_message;
  }
  return candidate.message ?? candidate.cause?.name ?? "NEAR RPC error";
}

/** Create a testnet account through the official NEAR testnet helper. */
export async function createTestnetAccount(
  accountId: string,
  publicKey: string,
  config: NearConfig = TESTNET,
): Promise<{ accountId: string; publicKey: string }> {
  const response = await fetch(new URL("/account", config.helperUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`testnet helper rejected ${accountId}: HTTP ${response.status} ${text.slice(0, 400)}`);
  }
  return { accountId, publicKey };
}

export async function getAccountBalance(
  accountId: string,
  config: NearConfig = TESTNET,
): Promise<{ total: bigint; storageUsage: number } | null> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "agentspend",
      method: "query",
      params: {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      },
    }),
  });
  const payload = (await response.json()) as {
    result?: { amount: string; storage_usage: number };
    error?: { cause?: { name?: string }; message?: string };
  };
  if (payload.error) {
    if (payload.error.cause?.name === "UNKNOWN_ACCOUNT") return null;
    throw new Error(payload.error.message ?? "view_account failed");
  }
  if (!payload.result) return null;
  return { total: BigInt(payload.result.amount), storageUsage: payload.result.storage_usage };
}

/** Read-only contract call through raw JSON-RPC (finality: final). */
export async function viewFunction<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
  config: NearConfig = TESTNET,
): Promise<T> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "agentspend",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
      },
    }),
  });
  const payload = (await response.json()) as {
    result?: { result: number[]; logs: string[] };
    error?: { cause?: { name?: string; info?: unknown }; message?: string };
  };
  if (payload.error) {
    throw new Error(describeRpcError(payload.error));
  }
  if (!payload.result) throw new Error(`view ${method} returned no result`);
  const text = Buffer.from(payload.result.result).toString("utf8");
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface SendResult {
  txHash: string;
  success: boolean;
  status: unknown;
  finalExecutionStatus: string;
  error: string | null;
  logs: string[];
  outcome: unknown;
}

function extractLogs(outcome: {
  receipts_outcome?: Array<{ outcome?: { logs?: string[] } }>;
  transaction_outcome?: { outcome?: { logs?: string[] } };
}): string[] {
  const logs: string[] = [];
  if (outcome.transaction_outcome?.outcome?.logs) logs.push(...outcome.transaction_outcome.outcome.logs);
  for (const receipt of outcome.receipts_outcome ?? []) {
    if (receipt.outcome?.logs) logs.push(...receipt.outcome.logs);
  }
  return logs;
}

export async function sendTransaction(params: {
  accountId: string;
  secretKey: string;
  receiverId: string;
  actions: Action[];
  waitUntil?: "FINAL" | "INCLUDED_FINAL" | "EXECUTED";
  config?: NearConfig;
}): Promise<SendResult> {
  const config = params.config ?? TESTNET;
  const account = new Account(params.accountId, getProvider(config), params.secretKey as KeyPairString);
  let outcome: Awaited<ReturnType<Account["signAndSendTransaction"]>>;
  try {
    outcome = await account.signAndSendTransaction({
      receiverId: params.receiverId,
      actions: params.actions,
      waitUntil: params.waitUntil ?? "FINAL",
      throwOnFailure: false,
    });
  } catch (error) {
    throw new Error(describeRpcError(error));
  }

  const record = outcome as unknown as {
    final_execution_status?: string;
    status?: unknown;
    transaction_outcome?: { id?: string; outcome?: { logs?: string[] } };
    receipts_outcome?: Array<{ outcome?: { logs?: string[] } }>;
  };
  const status = record.status;
  const success =
    status !== "Failure" &&
    !(status && typeof status === "object" && "Failure" in (status as Record<string, unknown>)) &&
    !(status === "NotStarted" || status === "Started");
  let error: string | null = null;
  if (status && typeof status === "object" && "Failure" in (status as Record<string, unknown>)) {
    const failure = (status as { Failure?: { error_message?: string } }).Failure;
    error = failure?.error_message ?? "transaction failed";
  }
  return {
    txHash: record.transaction_outcome?.id ?? "",
    success,
    status,
    finalExecutionStatus: record.final_execution_status ?? "unknown",
    error,
    logs: extractLogs(record),
    outcome,
  };
}

export async function callMethod(params: {
  accountId: string;
  secretKey: string;
  contractId: string;
  method: string;
  args?: Record<string, unknown>;
  deposit?: bigint;
  gas?: bigint;
  config?: NearConfig;
}): Promise<SendResult> {
  return sendTransaction({
    accountId: params.accountId,
    secretKey: params.secretKey,
    receiverId: params.contractId,
    actions: [
      nearActions.functionCall(
        params.method,
        params.args ?? {},
        params.gas ?? 100n * TGAS,
        params.deposit ?? 0n,
      ),
    ],
    config: params.config,
  });
}

export async function deployContract(params: {
  accountId: string;
  secretKey: string;
  wasm: Uint8Array;
  config?: NearConfig;
}): Promise<SendResult> {
  return sendTransaction({
    accountId: params.accountId,
    secretKey: params.secretKey,
    receiverId: params.accountId,
    actions: [nearActions.deployContract(params.wasm)],
    config: params.config,
  });
}

export async function deleteKey(params: {
  accountId: string;
  secretKey: string;
  publicKey: string;
  config?: NearConfig;
}): Promise<SendResult> {
  return sendTransaction({
    accountId: params.accountId,
    secretKey: params.secretKey,
    receiverId: params.accountId,
    actions: [nearActions.deleteKey(PublicKey.from(params.publicKey))],
    config: params.config,
  });
}

export async function addFullAccessKey(params: {
  accountId: string;
  secretKey: string;
  publicKey: string;
  config?: NearConfig;
}): Promise<SendResult> {
  return sendTransaction({
    accountId: params.accountId,
    secretKey: params.secretKey,
    receiverId: params.accountId,
    actions: [nearActions.addFullAccessKey(PublicKey.from(params.publicKey))],
    config: params.config,
  });
}

export async function transferNear(params: {
  accountId: string;
  secretKey: string;
  receiverId: string;
  amount: bigint;
  config?: NearConfig;
}): Promise<SendResult> {
  return sendTransaction({
    accountId: params.accountId,
    secretKey: params.secretKey,
    receiverId: params.receiverId,
    actions: [nearActions.transfer(params.amount)],
    config: params.config,
  });
}

// ---------------------------------------------------------------------------
// NEP-141 helpers
// ---------------------------------------------------------------------------

export async function ftBalanceOf(
  tokenAccount: string,
  accountId: string,
  config: NearConfig = TESTNET,
): Promise<bigint> {
  const result = await viewFunction<{ value?: string } | string>(
    tokenAccount,
    "ft_balance_of",
    { account_id: accountId },
    config,
  );
  const value = typeof result === "string" ? result : result?.value;
  return BigInt(value ?? "0");
}

export async function ftMetadata(
  tokenAccount: string,
  config: NearConfig = TESTNET,
): Promise<{ symbol: string; decimals: number; name: string }> {
  return viewFunction(tokenAccount, "ft_metadata", {}, config);
}

export async function storageDeposit(params: {
  tokenAccount: string;
  signerAccount: string;
  secretKey: string;
  accountId: string;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.signerAccount,
    secretKey: params.secretKey,
    contractId: params.tokenAccount,
    method: "storage_deposit",
    args: { account_id: params.accountId, registration_only: true },
    deposit: STORAGE_DEPOSIT_YOCTO,
    gas: 30n * TGAS,
    config: params.config,
  });
}

export async function ftTransferCall(params: {
  tokenAccount: string;
  signerAccount: string;
  secretKey: string;
  receiverId: string;
  amount: bigint;
  msg: string;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.signerAccount,
    secretKey: params.secretKey,
    contractId: params.tokenAccount,
    method: "ft_transfer_call",
    args: { receiver_id: params.receiverId, amount: params.amount.toString(), msg: params.msg },
    deposit: ONE_YOCTO,
    gas: 60n * TGAS,
    config: params.config,
  });
}

export async function ftTransfer(params: {
  tokenAccount: string;
  signerAccount: string;
  secretKey: string;
  receiverId: string;
  amount: bigint;
  memo?: string;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.signerAccount,
    secretKey: params.secretKey,
    contractId: params.tokenAccount,
    method: "ft_transfer",
    args: {
      receiver_id: params.receiverId,
      amount: params.amount.toString(),
      memo: params.memo ?? null,
    },
    deposit: ONE_YOCTO,
    gas: 30n * TGAS,
    config: params.config,
  });
}

export async function mintTestToken(params: {
  tokenAccount: string;
  issuerAccount: string;
  issuerSecretKey: string;
  accountId: string;
  amount: bigint;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.issuerAccount,
    secretKey: params.issuerSecretKey,
    contractId: params.tokenAccount,
    method: "mint",
    args: { account_id: params.accountId, amount: params.amount.toString() },
    gas: 30n * TGAS,
    config: params.config,
  });
}

// ---------------------------------------------------------------------------
// AgentSpend vault types and calls
// ---------------------------------------------------------------------------

export interface VaultPolicyView {
  total_budget: string;
  per_tx_limit: string;
  daily_limit: string;
  weekly_limit: string;
  monthly_limit: string;
  valid_from_ms: number;
  expires_at_ms: number;
  unknown_merchant_mode: "Deny" | "RequireApproval" | { AllowWithCap: string };
  approval_mode: "All" | "NoneWithinPolicy" | "Selected" | "UnknownOnly";
  approval_selected_merchants: string[];
  version: number;
}

export interface VaultBalanceView {
  accounted_balance: string;
  reserved_debit: string;
  free_balance: string;
  total_gross_committed: string;
}

export interface VaultUsageView {
  day_index: number;
  day_gross: string;
  week_gross: string;
  month_gross: string;
  total_gross_committed: string;
}

export interface VaultStateView {
  config: {
    owner: string;
    token: string;
    fee_account: string;
    user_fee_bps: number;
    merchant_fee_bps: number;
    paused: boolean;
    network: string;
  };
  policy: VaultPolicyView;
  balance: VaultBalanceView;
  usage: VaultUsageView;
  agent_count: number;
  merchant_count: number;
}

export interface VaultPaymentView {
  payment_id: string;
  agent_id: string;
  merchant_id: string;
  payout: string;
  gross: string;
  user_fee: string;
  merchant_fee: string;
  net: string;
  day_index: number;
  status: "Reserved" | "MerchantPaid" | "Succeeded" | "Failed";
  fee_owed: string;
  created_at_ms: number;
  terminal_at_ms: number;
}

export async function getVaultState(
  vaultAccount: string,
  config: NearConfig = TESTNET,
): Promise<VaultStateView> {
  return viewFunction(vaultAccount, "get_state", {}, config);
}

export async function getVaultPayment(
  vaultAccount: string,
  paymentId: string,
  config: NearConfig = TESTNET,
): Promise<VaultPaymentView | null> {
  const result = await viewFunction<VaultPaymentView | null>(
    vaultAccount,
    "get_payment",
    { payment_id: paymentId },
    config,
  );
  return result ?? null;
}

export async function agentPay(params: {
  vaultAccount: string;
  agentSecretKey: string;
  paymentId: string;
  merchantId: string;
  gross: bigint;
  requestExpiryMs: number;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.vaultAccount,
    secretKey: params.agentSecretKey,
    contractId: params.vaultAccount,
    method: "pay",
    args: {
      payment_id: params.paymentId,
      merchant_id: params.merchantId,
      gross: params.gross.toString(),
      request_expiry_ms: params.requestExpiryMs,
    },
    gas: 200n * TGAS,
    config: params.config,
  });
}

export async function ownerCall(params: {
  vaultAccount: string;
  ownerAccount: string;
  ownerSecretKey: string;
  method: string;
  args?: Record<string, unknown>;
  deposit?: bigint;
  config?: NearConfig;
}): Promise<SendResult> {
  return callMethod({
    accountId: params.ownerAccount,
    secretKey: params.ownerSecretKey,
    contractId: params.vaultAccount,
    method: params.method,
    args: params.args,
    deposit: params.deposit,
    gas: 120n * TGAS,
    config: params.config,
  });
}

/** Wait for a transaction to reach FINAL and return its status. */
export async function getTransactionStatus(params: {
  txHash: string;
  accountId: string;
  config?: NearConfig;
}): Promise<{
  finalExecutionStatus: string;
  success: boolean;
  error: string | null;
  logs: string[];
  status: unknown;
}> {
  const config = params.config ?? TESTNET;
  try {
    const outcome = await getProvider(config).viewTransactionStatus({
      txHash: params.txHash,
      accountId: params.accountId,
      waitUntil: "FINAL",
    });
    const record = outcome as unknown as {
      final_execution_status?: string;
      status?: unknown;
      transaction_outcome?: { outcome?: { logs?: string[] } };
      receipts_outcome?: Array<{ outcome?: { logs?: string[] } }>;
    };
    const status = record.status;
    const success =
      status !== "Failure" &&
      !(status && typeof status === "object" && "Failure" in (status as Record<string, unknown>)) &&
      !(status === "NotStarted" || status === "Started");
    let error: string | null = null;
    if (status && typeof status === "object" && "Failure" in (status as Record<string, unknown>)) {
      const failure = (status as { Failure?: { error_message?: string } }).Failure;
      error = failure?.error_message ?? "transaction failed";
    }
    return {
      finalExecutionStatus: record.final_execution_status ?? "unknown",
      success,
      error,
      logs: extractLogs(record),
      status,
    };
  } catch (error) {
    throw new Error(describeRpcError(error));
  }
}

/**
 * Verify a NEP-413 login signature. The public key must belong to the account
 * and the signature must cover the exact message, recipient and nonce.
 */
export async function verifyNep413(input: {
  accountId: string;
  publicKey: string;
  message: string;
  recipient: string;
  nonce: Uint8Array;
  signature: Uint8Array;
  config?: NearConfig;
}): Promise<void> {
  await verifyMessage({
    signerAccountId: input.accountId,
    signerPublicKey: input.publicKey,
    payload: {
      message: input.message,
      recipient: input.recipient,
      nonce: input.nonce,
    },
    signature: input.signature,
    provider: getProvider(input.config ?? TESTNET),
  });
}

export function explorerTxUrl(txHash: string): string {
  return `https://testnet.nearblocks.io/txns/${txHash}`;
}

export function explorerAccountUrl(accountId: string): string {
  return `https://testnet.nearblocks.io/address/${accountId}`;
}
