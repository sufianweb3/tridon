import type {
  ApprovalMode,
  MerchantRule,
  Policy,
  UnknownMerchantMode,
} from "@agentspend/core";
import { query, queryOne } from "./db";

export interface PolicyRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  vault_id: string | null;
  name: string;
  status: "active" | "paused" | "revoked";
  total_budget: string;
  per_tx_limit: string;
  daily_limit: string;
  weekly_limit: string;
  monthly_limit: string;
  unknown_merchant_mode: UnknownMerchantMode;
  unknown_merchant_cap: string;
  approval_mode: ApprovalMode;
  valid_from: number;
  expires_at: number;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface PolicyRuleRow {
  id: string;
  policy_id: string;
  merchant_id: string;
  payout_account: string;
  per_tx_limit: string;
  window_limit: string;
  window_secs: number;
  allowlisted: number;
  requires_approval: number;
  active: number;
  created_at: number;
}

export interface LoadedPolicy {
  row: PolicyRow;
  rules: PolicyRuleRow[];
  selectedMerchantIds: Set<string>;
}

export async function loadPolicyById(policyId: string): Promise<LoadedPolicy | null> {
  const row = await queryOne<PolicyRow>("SELECT * FROM policies WHERE id = ?", [policyId]);
  if (!row) return null;
  return { row, ...(await loadRules(policyId)) };
}

export async function loadPolicyForVault(vaultId: string): Promise<LoadedPolicy | null> {
  const row = await queryOne<PolicyRow>(
    "SELECT * FROM policies WHERE vault_id = ? AND status != 'revoked' ORDER BY created_at DESC LIMIT 1",
    [vaultId],
  );
  if (!row) return null;
  return { row, ...(await loadRules(row.id)) };
}

/**
 * A vault has exactly one on-chain policy. Agents are distinct signing
 * identities under that policy, not separate budgets.
 */
export async function loadPolicyForAgent(agentId: string): Promise<LoadedPolicy | null> {
  const row = await queryOne<PolicyRow>(
    `SELECT p.* FROM policies p
     JOIN agents a ON a.vault_id = p.vault_id
     WHERE a.id = ? AND p.status != 'revoked'
     ORDER BY p.created_at DESC LIMIT 1`,
    [agentId],
  );
  if (!row) return null;
  return { row, ...(await loadRules(row.id)) };
}

export async function loadPoliciesForUser(userId: string): Promise<LoadedPolicy[]> {
  const rows = await query<PolicyRow>(
    "SELECT * FROM policies WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  return Promise.all(rows.map(async (row) => ({ row, ...(await loadRules(row.id)) })));
}

async function loadRules(policyId: string): Promise<{
  rules: PolicyRuleRow[];
  selectedMerchantIds: Set<string>;
}> {
  const rules = await query<PolicyRuleRow>(
    "SELECT * FROM policy_merchant_rules WHERE policy_id = ? ORDER BY created_at",
    [policyId],
  );
  const selectedMerchantIds = new Set(
    rules.filter((rule) => rule.requires_approval === 1).map((rule) => rule.merchant_id),
  );
  return { rules, selectedMerchantIds };
}

export function corePolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    status: row.status,
    totalBudget: BigInt(row.total_budget),
    perTxLimit: BigInt(row.per_tx_limit),
    dailyLimit: BigInt(row.daily_limit),
    weeklyLimit: BigInt(row.weekly_limit),
    monthlyLimit: BigInt(row.monthly_limit),
    unknownMerchantMode: row.unknown_merchant_mode,
    unknownMerchantCap: BigInt(row.unknown_merchant_cap),
    approvalMode: row.approval_mode,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    version: row.version,
  };
}

export function coreMerchantRule(row: PolicyRuleRow): MerchantRule {
  return {
    merchantId: row.merchant_id,
    payoutAccount: row.payout_account,
    perTxLimit: BigInt(row.per_tx_limit),
    windowLimit: BigInt(row.window_limit),
    windowSecs: row.window_secs,
    windowSpent: 0n,
    windowStart: 0,
    active: row.active === 1,
    allowlisted: row.allowlisted === 1,
  };
}

export function ruleForMerchant(
  policy: LoadedPolicy,
  merchantId: string,
): PolicyRuleRow | null {
  return policy.rules.find((rule) => rule.merchant_id === merchantId) ?? null;
}

/** Contract JSON uses the Rust enum serialization near-sdk expects. */
export function contractPolicyJson(row: PolicyRow, rules: PolicyRuleRow[] = []) {
  const unknown =
    row.unknown_merchant_mode === "deny"
      ? "Deny"
      : row.unknown_merchant_mode === "require_approval"
        ? "RequireApproval"
        : { AllowWithCap: row.unknown_merchant_cap };
  const approval =
    row.approval_mode === "all"
      ? "All"
      : row.approval_mode === "none_within_policy"
        ? "NoneWithinPolicy"
        : row.approval_mode === "selected_merchants"
          ? "Selected"
          : "UnknownOnly";
  return {
    total_budget: row.total_budget,
    per_tx_limit: row.per_tx_limit,
    daily_limit: row.daily_limit,
    weekly_limit: row.weekly_limit,
    monthly_limit: row.monthly_limit,
    valid_from_ms: row.valid_from,
    expires_at_ms: row.expires_at,
    unknown_merchant_mode: unknown,
    approval_mode: approval,
    approval_selected_merchants: rules
      .filter((rule) => rule.requires_approval === 1)
      .map((rule) => rule.merchant_id),
    version: row.version,
  };
}

export function contractMerchantSeeds(rules: PolicyRuleRow[]) {
  return rules
    .filter((rule) => rule.active === 1)
    .map((rule) => ({
      merchant_id: rule.merchant_id,
      payout: rule.payout_account,
      per_tx_limit: rule.per_tx_limit,
      window_limit: rule.window_limit,
      window_secs: rule.window_secs,
      allowlisted: rule.allowlisted === 1,
    }));
}

export function unknownModeLabel(mode: UnknownMerchantMode): string {
  if (mode === "deny") return "Block anything off the allowlist";
  if (mode === "require_approval") return "Ask me before paying an unlisted merchant";
  return "Allow unlisted merchants under a hard cap";
}

export function approvalModeLabel(mode: ApprovalMode): string {
  if (mode === "all") return "Every payment needs approval";
  if (mode === "none_within_policy") return "No approval while inside the policy";
  if (mode === "selected_merchants") return "Approval for selected merchants";
  return "Approval for unlisted merchants";
}

export interface PolicySummaryLine {
  label: string;
  value: string;
}

export function policySummary(policy: LoadedPolicy): PolicySummaryLine[] {
  const { row, rules } = policy;
  const allowlisted = rules.filter((rule) => rule.allowlisted === 1 && rule.active === 1);
  return [
    { label: "Total budget", value: row.total_budget },
    { label: "Per payment", value: row.per_tx_limit },
    { label: "Daily", value: row.daily_limit === "0" ? "No cap" : row.daily_limit },
    { label: "Weekly", value: row.weekly_limit === "0" ? "No cap" : row.weekly_limit },
    { label: "Monthly", value: row.monthly_limit === "0" ? "No cap" : row.monthly_limit },
    { label: "Allowlisted merchants", value: String(allowlisted.length) },
    { label: "Unknown merchants", value: unknownModeLabel(row.unknown_merchant_mode) },
    { label: "Approvals", value: approvalModeLabel(row.approval_mode) },
  ];
}

export function policyForMerchant(
  policy: LoadedPolicy,
  merchantId: string,
): { allowlisted: boolean; perTxLimit: string; requiresApproval: boolean } | null {
  const rule = ruleForMerchant(policy, merchantId);
  if (!rule) return null;
  return {
    allowlisted: rule.allowlisted === 1,
    perTxLimit: rule.per_tx_limit,
    requiresApproval: rule.requires_approval === 1,
  };
}
