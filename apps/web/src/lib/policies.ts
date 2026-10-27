import type { ApprovalMode, UnknownMerchantMode } from "@agentspend/core";
import { ApiError } from "./api";
import { audit } from "./audit";
import { getDb, now, withTransaction } from "./db";
import {
  approvalModeLabel,
  contractPolicyJson,
  loadPolicyById,
  loadPolicyForVault,
  unknownModeLabel,
  type LoadedPolicy,
  type PolicyRow,
  type PolicyRuleRow,
} from "./policy-service";
import { pauseVaultPolicy, syncPolicyToVault, vaultForUser } from "./platform";
import { budgetSummary } from "./usage";

export interface PolicySpecInput {
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

export interface PolicyRuleView {
  merchantId: string;
  merchantName: string;
  merchantCategory: string;
  payoutAccount: string;
  allowlisted: boolean;
  active: boolean;
  perTxLimit: string;
  windowLimit: string;
  windowSecs: number;
  requiresApproval: boolean;
}

export interface PolicyView {
  id: string;
  name: string;
  status: string;
  vaultId: string | null;
  rail: string | null;
  vaultAccount: string | null;
  totalBudget: string;
  perTxLimit: string;
  dailyLimit: string;
  weeklyLimit: string;
  monthlyLimit: string;
  unknownMerchantMode: UnknownMerchantMode;
  unknownMerchantModeLabel: string;
  unknownMerchantCap: string;
  approvalMode: ApprovalMode;
  approvalModeLabel: string;
  validFrom: number;
  expiresAt: number;
  version: number;
  updatedAt: number;
  rules: PolicyRuleView[];
  usage: {
    committed: string;
    held: string;
    remaining: string;
    balance: string;
    available: string;
    dayGross: string;
    weekGross: string;
    monthGross: string;
  };
}

const AMOUNT_RE = /^\d{1,24}$/;

function amount(value: string, label: string, allowZero = true): string {
  const trimmed = value.trim();
  if (!AMOUNT_RE.test(trimmed)) {
    throw new ApiError(400, "INVALID_AMOUNT", `${label} must be an integer amount in base units.`);
  }
  const parsed = BigInt(trimmed);
  if (!allowZero && parsed <= 0n) {
    throw new ApiError(400, "INVALID_AMOUNT", `${label} must be greater than zero.`);
  }
  return parsed.toString();
}

function validateSpec(input: PolicySpecInput): PolicySpecInput {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 64) {
    throw new ApiError(400, "INVALID_POLICY_NAME", "Policy name must be 2-64 characters.");
  }
  if (
    !["deny", "require_approval", "allow_with_cap"].includes(input.unknownMerchantMode)
  ) {
    throw new ApiError(400, "INVALID_POLICY", "Unknown merchant mode is not valid.");
  }
  if (
    !["all", "none_within_policy", "selected_merchants", "unknown_merchants"].includes(
      input.approvalMode,
    )
  ) {
    throw new ApiError(400, "INVALID_POLICY", "Approval mode is not valid.");
  }
  const totalBudget = amount(input.totalBudget, "Total budget", false);
  const perTxLimit = amount(input.perTxLimit, "Per-payment limit", false);
  const dailyLimit = amount(input.dailyLimit, "Daily limit");
  const weeklyLimit = amount(input.weeklyLimit, "Weekly limit");
  const monthlyLimit = amount(input.monthlyLimit, "Monthly limit");
  const unknownMerchantCap = amount(input.unknownMerchantCap, "Unknown merchant cap");
  if (input.unknownMerchantMode === "allow_with_cap" && BigInt(unknownMerchantCap) <= 0n) {
    throw new ApiError(
      400,
      "INVALID_POLICY",
      "A positive cap is required when unknown merchants are allowed.",
    );
  }

  const seen = new Set<string>();
  const rules: PolicySpecInput["rules"] = [];
  for (const rule of input.rules) {
    if (seen.has(rule.merchantId)) {
      throw new ApiError(400, "INVALID_POLICY", "A merchant appears twice in the policy.");
    }
    seen.add(rule.merchantId);
    const merchant = getDb()
      .prepare("SELECT id FROM merchants WHERE id = ? AND active = 1")
      .get(rule.merchantId) as { id: string } | undefined;
    if (!merchant) {
      throw new ApiError(400, "INVALID_POLICY", `Unknown merchant ${rule.merchantId}.`);
    }
    const windowLimit = amount(rule.windowLimit, "Merchant window limit");
    const windowSecs = Math.trunc(rule.windowSecs);
    if (windowSecs < 0 || windowSecs > 30 * 24 * 60 * 60) {
      throw new ApiError(400, "INVALID_POLICY", "Merchant window must be at most 30 days.");
    }
    if (BigInt(windowLimit) > 0n && windowSecs <= 0) {
      throw new ApiError(
        400,
        "INVALID_POLICY",
        "A merchant window limit needs a window duration.",
      );
    }
    rules.push({
      merchantId: rule.merchantId,
      allowlisted: rule.allowlisted,
      perTxLimit: amount(rule.perTxLimit, "Merchant per-payment limit"),
      windowLimit,
      windowSecs,
      requiresApproval: rule.requiresApproval,
    });
  }

  return {
    name,
    totalBudget,
    perTxLimit,
    dailyLimit,
    weeklyLimit,
    monthlyLimit,
    unknownMerchantMode: input.unknownMerchantMode,
    unknownMerchantCap:
      input.unknownMerchantMode === "allow_with_cap" ? unknownMerchantCap : "0",
    approvalMode: input.approvalMode,
    rules,
  };
}

export function policyForUser(userId: string): LoadedPolicy | null {
  const vault = vaultForUser(userId);
  if (!vault) return null;
  return loadPolicyForVault(vault.id);
}

export function policyView(policy: LoadedPolicy): PolicyView {
  const vault = policy.row.vault_id
    ? (getDb()
        .prepare("SELECT account_id, rail FROM vaults WHERE id = ?")
        .get(policy.row.vault_id) as { account_id: string; rail: string } | undefined)
    : undefined;
  const summary = budgetSummary({
    policyId: policy.row.id,
    totalBudget: BigInt(policy.row.total_budget),
    now: now(),
  });
  const merchantNames = new Map(
    (
      getDb()
        .prepare("SELECT id, name, category FROM merchants")
        .all() as unknown as Array<{ id: string; name: string; category: string }>
    ).map((merchant) => [merchant.id, merchant]),
  );
  const rules = policy.rules
    .filter((rule) => rule.active === 1)
    .map((rule) => ({
      merchantId: rule.merchant_id,
      merchantName: merchantNames.get(rule.merchant_id)?.name ?? rule.merchant_id,
      merchantCategory: merchantNames.get(rule.merchant_id)?.category ?? "Unknown",
      payoutAccount: rule.payout_account,
      allowlisted: rule.allowlisted === 1,
      active: rule.active === 1,
      perTxLimit: rule.per_tx_limit,
      windowLimit: rule.window_limit,
      windowSecs: rule.window_secs,
      requiresApproval: rule.requires_approval === 1,
    }));
  return {
    id: policy.row.id,
    name: policy.row.name,
    status: policy.row.status,
    vaultId: policy.row.vault_id,
    rail: vault?.rail ?? null,
    vaultAccount: vault?.account_id ?? null,
    totalBudget: policy.row.total_budget,
    perTxLimit: policy.row.per_tx_limit,
    dailyLimit: policy.row.daily_limit,
    weeklyLimit: policy.row.weekly_limit,
    monthlyLimit: policy.row.monthly_limit,
    unknownMerchantMode: policy.row.unknown_merchant_mode,
    unknownMerchantModeLabel: unknownModeLabel(policy.row.unknown_merchant_mode),
    unknownMerchantCap: policy.row.unknown_merchant_cap,
    approvalMode: policy.row.approval_mode,
    approvalModeLabel: approvalModeLabel(policy.row.approval_mode),
    validFrom: policy.row.valid_from,
    expiresAt: policy.row.expires_at,
    version: policy.row.version,
    updatedAt: policy.row.updated_at,
    rules,
    usage: {
      committed: summary.committedGross.toString(),
      held: summary.heldGross.toString(),
      remaining: summary.remaining.toString(),
      balance: summary.balance.toString(),
      available: summary.availableBalance.toString(),
      dayGross: summary.dayGross.toString(),
      weekGross: summary.weekGross.toString(),
      monthGross: summary.monthGross.toString(),
    },
  };
}

function writeSpec(input: {
  policy: LoadedPolicy;
  spec: PolicySpecInput;
}): { removedMerchantIds: string[] } {
  const { policy, spec } = input;
  const timestamp = now();
  const keep = new Set(spec.rules.map((rule) => rule.merchantId));
  const removedMerchantIds = policy.rules
    .filter((rule) => rule.active === 1 && !keep.has(rule.merchant_id))
    .map((rule) => rule.merchant_id);

  getDb()
    .prepare(
      `UPDATE policies SET name = ?, total_budget = ?, per_tx_limit = ?, daily_limit = ?,
         weekly_limit = ?, monthly_limit = ?, unknown_merchant_mode = ?, unknown_merchant_cap = ?,
         approval_mode = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      spec.name,
      spec.totalBudget,
      spec.perTxLimit,
      spec.dailyLimit,
      spec.weeklyLimit,
      spec.monthlyLimit,
      spec.unknownMerchantMode,
      spec.unknownMerchantCap,
      spec.approvalMode,
      timestamp,
      policy.row.id,
    );

  getDb()
    .prepare("UPDATE policy_merchant_rules SET active = 0 WHERE policy_id = ?")
    .run(policy.row.id);

  for (const rule of spec.rules) {
    const merchant = getDb()
      .prepare("SELECT payout_account FROM merchants WHERE id = ?")
      .get(rule.merchantId) as { payout_account: string } | undefined;
    if (!merchant) continue;
    getDb()
      .prepare(
        `INSERT INTO policy_merchant_rules (id, policy_id, merchant_id, payout_account,
           per_tx_limit, window_limit, window_secs, allowlisted, requires_approval, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(policy_id, merchant_id) DO UPDATE SET
           payout_account = excluded.payout_account,
           per_tx_limit = excluded.per_tx_limit,
           window_limit = excluded.window_limit,
           window_secs = excluded.window_secs,
           allowlisted = excluded.allowlisted,
           requires_approval = excluded.requires_approval,
           active = 1`,
      )
      .run(
        `rule_${policy.row.id}_${rule.merchantId}`,
        policy.row.id,
        rule.merchantId,
        merchant.payout_account,
        rule.perTxLimit,
        rule.windowLimit,
        rule.windowSecs,
        rule.allowlisted ? 1 : 0,
        rule.requiresApproval ? 1 : 0,
        timestamp,
      );
  }

  return { removedMerchantIds };
}

export async function updatePolicy(input: {
  userId: string;
  policyId?: string;
  spec: PolicySpecInput;
}): Promise<{ policy: PolicyView; txHash: string | null; version: number }> {
  const spec = validateSpec(input.spec);
  const policy = policyForUser(input.userId);
  if (!policy) throw new ApiError(404, "POLICY_NOT_FOUND", "Policy not found.");
  if (input.policyId && input.policyId !== policy.row.id) {
    throw new ApiError(404, "POLICY_NOT_FOUND", "Policy not found.");
  }
  if (policy.row.status === "revoked") {
    throw new ApiError(409, "POLICY_REVOKED", "A revoked policy cannot be edited.");
  }

  const { removedMerchantIds } = withTransaction(() => {
    const result = writeSpec({ policy, spec });
    audit({
      userId: input.userId,
      actor: "user",
      eventType: "policy.updated",
      detail: {
        policyId: policy.row.id,
        version: policy.row.version,
        totalBudget: spec.totalBudget,
        perTxLimit: spec.perTxLimit,
        unknownMerchantMode: spec.unknownMerchantMode,
        approvalMode: spec.approvalMode,
        removedMerchantIds: result.removedMerchantIds,
      },
    });
    return result;
  });

  try {
    const synced = await syncPolicyToVault({
      policyId: policy.row.id,
      removedMerchantIds,
    });
    audit({
      userId: input.userId,
      actor: "chain",
      eventType: "policy.synced",
      detail: { policyId: policy.row.id, txHash: synced.txHash, version: synced.version },
    });
    const fresh = loadPolicyById(policy.row.id)!;
    return { policy: policyView(fresh), txHash: synced.txHash, version: synced.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown chain error";
    // Fail closed. The local copy is paused immediately; the chain pause is
    // attempted as well. Even if the chain call fails, the backend will deny.
    withTransaction(() => {
      getDb()
        .prepare("UPDATE policies SET status = 'paused', updated_at = ? WHERE id = ?")
        .run(now(), policy.row.id);
      audit({
        userId: input.userId,
        actor: "system",
        eventType: "policy.sync_failed",
        detail: { policyId: policy.row.id, error: message },
      });
    });
    let chainPaused = false;
    try {
      await pauseVaultPolicy(policy.row.id, true);
      chainPaused = true;
    } catch {
      chainPaused = false;
    }
    throw new ApiError(
      502,
      "POLICY_SYNC_FAILED",
      chainPaused
        ? `The on-chain policy update failed and the policy was paused: ${message}`
        : `The on-chain policy update failed and the backend paused the policy, but the on-chain pause also failed. Do not send payments until this is resolved: ${message}`,
    );
  }
}

export async function setPolicyPaused(input: {
  userId: string;
  paused: boolean;
}): Promise<PolicyView> {
  const policy = policyForUser(input.userId);
  if (!policy) throw new ApiError(404, "POLICY_NOT_FOUND", "Policy not found.");
  if (policy.row.status === "revoked") {
    throw new ApiError(409, "POLICY_REVOKED", "A revoked policy cannot be resumed.");
  }
  if (input.paused === (policy.row.status === "paused")) {
    return policyView(policy);
  }
  try {
    await pauseVaultPolicy(policy.row.id, input.paused);
  } catch (error) {
    throw new ApiError(
      502,
      "POLICY_PAUSE_FAILED",
      error instanceof Error
        ? `The on-chain ${input.paused ? "pause" : "resume"} failed: ${error.message}`
        : `The on-chain ${input.paused ? "pause" : "resume"} failed.`,
    );
  }
  withTransaction(() => {
    getDb()
      .prepare("UPDATE policies SET status = ?, updated_at = ? WHERE id = ?")
      .run(input.paused ? "paused" : "active", now(), policy.row.id);
    audit({
      userId: input.userId,
      actor: "user",
      eventType: input.paused ? "policy.paused" : "policy.resumed",
      detail: { policyId: policy.row.id },
    });
  });
  return policyView(loadPolicyById(policy.row.id)!);
}

export async function revokePolicy(input: {
  userId: string;
  confirmation: string;
}): Promise<PolicyView> {
  if (input.confirmation !== "REVOKE") {
    throw new ApiError(400, "CONFIRMATION_REQUIRED", 'Type REVOKE to revoke the policy.');
  }
  const policy = policyForUser(input.userId);
  if (!policy) throw new ApiError(404, "POLICY_NOT_FOUND", "Policy not found.");
  if (policy.row.status === "revoked") return policyView(policy);
  try {
    await pauseVaultPolicy(policy.row.id, true);
  } catch (error) {
    throw new ApiError(
      502,
      "POLICY_REVOKE_FAILED",
      error instanceof Error
        ? `The on-chain pause failed, so the policy was not revoked: ${error.message}`
        : "The on-chain pause failed, so the policy was not revoked.",
    );
  }
  withTransaction(() => {
    getDb()
      .prepare("UPDATE policies SET status = 'revoked', updated_at = ? WHERE id = ?")
      .run(now(), policy.row.id);
    audit({
      userId: input.userId,
      actor: "user",
      eventType: "policy.revoked",
      detail: { policyId: policy.row.id },
    });
  });
  return policyView(loadPolicyById(policy.row.id)!);
}

export function ruleForMerchant(
  policy: LoadedPolicy,
  merchantId: string,
): PolicyRuleRow | null {
  return policy.rules.find((rule) => rule.merchant_id === merchantId && rule.active === 1) ?? null;
}

export function policyRuleRows(policy: LoadedPolicy): PolicyRuleRow[] {
  return policy.rules.filter((rule) => rule.active === 1);
}

export function policyContractJson(policy: LoadedPolicy): ReturnType<typeof contractPolicyJson> {
  return contractPolicyJson(policy.row, policy.rules);
}

export function policyRowForUser(userId: string): PolicyRow | null {
  return policyForUser(userId)?.row ?? null;
}
