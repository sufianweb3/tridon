import { formatUsd } from "@agentspend/core";
import type { PaymentRow } from "./payments";
import { getAgent, getMerchant, getApprovalForPayment } from "./payments";
import { now, queryOne, setting } from "./db";
import { appConfig, explorerAccount, explorerTx } from "./config";
import { listAgentRows, agentView, type AgentView } from "./agents";
import { policyForUser, policyView, type PolicyView } from "./policies";
import { pendingApprovals } from "./payments";
import { listPayments } from "./payments";
import { listAudit } from "./audit";
import { budgetSummary } from "./usage";
import { vaultForUser } from "./platform";

export interface PaymentView {
  id: string;
  status: string;
  decision: string | null;
  denyCode: string | null;
  denyMessage: string | null;
  createdAt: number;
  updatedAt: number;
  rail: string;
  railLabel: string;
  enforcement: string;
  asset: string;
  network: string;
  gross: string;
  userFee: string;
  merchantFee: string;
  net: string;
  grossUsd: string;
  userFeeUsd: string;
  merchantFeeUsd: string;
  netUsd: string;
  /**
   * Fee fields are the quoted amounts for this request. `feeState` says whether
   * they were actually charged. Only a succeeded payment can create fee ledger
   * entries; denied, failed and expired payments are never charged.
   */
  feeState: "not_charged" | "charged" | "owed";
  feeCharged: boolean;
  merchant: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  txHash: string | null;
  explorerUrl: string | null;
  settlementRef: string | null;
  chainStatus: string | null;
  error: string | null;
  requestExpiry: number;
  approval: { id: string; status: string; expiresAt: number } | null;
}

export async function paymentView(payment: PaymentRow): Promise<PaymentView> {
  const merchant = await getMerchant(payment.merchant_id);
  const agent = payment.agent_id ? await getAgent(payment.agent_id) : null;
  const approval = await getApprovalForPayment(payment.id);
  const live = payment.rail === "testnet";
  const feeState: PaymentView["feeState"] =
    payment.status !== "succeeded"
      ? "not_charged"
      : payment.chain_status === "merchant_paid_fee_pending"
        ? "owed"
        : "charged";
  return {
    id: payment.id,
    status: payment.status,
    decision: payment.decision,
    denyCode: payment.deny_code,
    denyMessage: payment.deny_message,
    createdAt: payment.created_at,
    updatedAt: payment.updated_at,
    rail: payment.rail,
    railLabel: live ? "NEAR testnet · on-chain vault" : "Mock rail · backend-enforced limits",
    enforcement: live
      ? "On-chain vault policy + backend pre-check"
      : "Application backend only (mock rail)",
    asset: payment.asset,
    network: payment.network,
    gross: payment.amount_gross,
    userFee: payment.user_fee,
    merchantFee: payment.merchant_fee,
    net: payment.amount_net,
    grossUsd: formatUsd(BigInt(payment.amount_gross)),
    userFeeUsd: formatUsd(BigInt(payment.user_fee)),
    merchantFeeUsd: formatUsd(BigInt(payment.merchant_fee)),
    netUsd: formatUsd(BigInt(payment.amount_net)),
    feeState,
    feeCharged: feeState === "charged",
    merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
    agent: agent ? { id: agent.id, name: agent.name } : null,
    txHash: payment.tx_hash,
    explorerUrl: payment.tx_hash ? explorerTx(payment.tx_hash) : null,
    settlementRef: payment.settlement_ref,
    chainStatus: payment.chain_status,
    error: payment.error,
    requestExpiry: payment.request_expiry,
    approval: approval
      ? { id: approval.id, status: approval.status, expiresAt: approval.expires_at }
      : null,
  };
}

export interface Overview {
  now: number;
  demo: boolean;
  token: {
    symbol: string;
    label: string;
    decimals: number;
    isCircleUsdc: boolean;
    note: string;
  };
  user: {
    id: string;
    wallet: string;
    displayName: string;
    role: string;
  };
  vault: {
    id: string;
    accountId: string;
    rail: string;
    railLabel: string;
    enforcement: string;
    balance: string;
    balanceUsd: string;
    chainStatus: string;
    network: string;
    tokenAccount: string;
    explorerUrl: string;
  } | null;
  policy: PolicyView | null;
  budget: {
    totalBudget: string;
    remaining: string;
    committed: string;
    held: string;
    available: string;
    balance: string;
    dayGross: string;
    weekGross: string;
    monthGross: string;
    totalBudgetUsd: string;
    remainingUsd: string;
    committedUsd: string;
    heldUsd: string;
    availableUsd: string;
    balanceUsd: string;
    dayGrossUsd: string;
    weekGrossUsd: string;
    monthGrossUsd: string;
  } | null;
  agents: AgentView[];
  approvals: Awaited<ReturnType<typeof pendingApprovals>>;
  payments: PaymentView[];
  audit: Array<{
    id: string;
    actor: string;
    eventType: string;
    detail: Record<string, unknown>;
    paymentId: string | null;
    createdAt: number;
  }>;
}

export async function userOverview(
  userId: string,
  user: {
    id: string;
    wallet: string;
    displayName: string;
    role: string;
  },
): Promise<Overview> {
  const vault = await vaultForUser(userId);
  const policy = await policyForUser(userId);
  const budget =
    policy === null
      ? null
      : await budgetSummary({
          policyId: policy.row.id,
          totalBudget: BigInt(policy.row.total_budget),
          now: now(),
        });
  const paymentRows = await listPayments({ userId, limit: 12 });
  const payments = await Promise.all(paymentRows.map(paymentView));
  const approvals = await pendingApprovals(userId);
  const agentRows = await listAgentRows(userId);
  const agents = await Promise.all(agentRows.map(agentView));
  const auditRows = await listAudit(24, userId);
  const audit = auditRows.map((event) => ({
    id: event.id,
    actor: event.actor,
    eventType: event.event_type,
    detail: safeJson(event.detail),
    paymentId: event.payment_id,
    createdAt: event.created_at,
  }));
  return {
    now: now(),
    demo: (await setting("demo.user_id", "")) === userId,
    token: {
      symbol: appConfig.token.symbol,
      label: appConfig.token.label,
      decimals: appConfig.token.decimals,
      isCircleUsdc: appConfig.token.isCircleUsdc,
      note: "TESTUSD is a demo NEP-141 token. It is not Circle USDC and has no monetary value.",
    },
    user,
    vault: vault
      ? {
          id: vault.id,
          accountId: vault.account_id,
          rail: vault.rail,
          railLabel:
            vault.rail === "testnet"
              ? "NEAR testnet · on-chain vault"
              : "Mock rail · backend-enforced limits",
          enforcement:
            vault.rail === "testnet"
              ? "The vault contract enforces the budget, allowlist, fees and payout destination."
              : "Limits are enforced by this application only. No chain transaction is produced.",
          balance: vault.balance,
          balanceUsd: formatUsd(BigInt(vault.balance)),
          chainStatus: vault.chain_status,
          network: vault.network,
          tokenAccount: vault.token_account,
          explorerUrl: vault.rail === "testnet" ? explorerAccount(vault.account_id) : "",
        }
      : null,
    policy: policy ? await policyView(policy) : null,
    budget: budget
      ? {
          totalBudget: budget.totalBudget.toString(),
          remaining: budget.remaining.toString(),
          committed: budget.committedGross.toString(),
          held: budget.heldGross.toString(),
          available: budget.availableBalance.toString(),
          balance: budget.balance.toString(),
          dayGross: budget.dayGross.toString(),
          weekGross: budget.weekGross.toString(),
          monthGross: budget.monthGross.toString(),
          totalBudgetUsd: formatUsd(budget.totalBudget),
          remainingUsd: formatUsd(budget.remaining),
          committedUsd: formatUsd(budget.committedGross),
          heldUsd: formatUsd(budget.heldGross),
          availableUsd: formatUsd(budget.availableBalance),
          balanceUsd: formatUsd(budget.balance),
          dayGrossUsd: formatUsd(budget.dayGross),
          weekGrossUsd: formatUsd(budget.weekGross),
          monthGrossUsd: formatUsd(budget.monthGross),
        }
      : null,
    agents,
    approvals,
    payments,
    audit,
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function countPendingApprovals(userId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM approvals a
     JOIN payment_requests p ON p.id = a.payment_id
     WHERE p.user_id = ? AND a.status = 'pending'`,
    [userId],
  );
  return row?.count ?? 0;
}
