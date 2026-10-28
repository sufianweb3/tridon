import {
  canTransition,
  evaluatePayment,
  formatUsd,
  isTerminal,
  type ApprovalRef,
  type PaymentStatus,
  type PolicyDecision,
} from "@agentspend/core";
import { ApiError } from "./api";
import { audit } from "./audit";
import { appConfig } from "./config";
import { randomId } from "./crypto";
import { execute, now, query, queryOne, withTransaction } from "./db";
import {
  coreMerchantRule,
  corePolicy,
  loadPolicyById,
  loadPolicyForVault,
  ruleForMerchant,
} from "./policy-service";
import {
  approveOnVault,
  syncVaultBalance,
  vaultById,
  type VaultRow,
} from "./platform";
import { mockRail } from "./rails/mock";
import { testnetRail } from "./rails/testnet";
import type { PaymentRail } from "./rails/types";
import { presignObject, putJsonObject, receiptObjectKey, storageConfigured } from "./storage";
import { budgetSummary, usageForPolicy } from "./usage";
import { emitMerchantEvent } from "./webhooks";

export interface PaymentRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  policy_id: string | null;
  merchant_id: string;
  service_id: string | null;
  merchant_request_id: string | null;
  amount_gross: string;
  user_fee: string;
  merchant_fee: string;
  amount_net: string;
  asset: string;
  network: string;
  status: PaymentStatus;
  decision: "ALLOW" | "DENY" | "REQUIRES_APPROVAL" | null;
  deny_code: string | null;
  deny_message: string | null;
  approval_id: string | null;
  idempotency_key: string;
  request_expiry: number;
  rail: string;
  tx_hash: string | null;
  chain_status: string | null;
  settlement_ref: string | null;
  error: string | null;
  simulate_failure: number;
  created_at: number;
  updated_at: number;
}

export interface ApprovalRow {
  id: string;
  payment_id: string;
  policy_id: string;
  approval_hash: string;
  status: string;
  expires_at: number;
  decided_at: number | null;
  tx_hash: string | null;
  created_at: number;
}

export interface AgentRow {
  id: string;
  user_id: string;
  vault_id: string | null;
  name: string;
  description: string | null;
  status: string;
  public_key: string | null;
  key_ciphertext: string | null;
  key_iv: string | null;
  key_tag: string | null;
  allowance_yocto: string | null;
  created_at: number;
  revoked_at: number | null;
}

export interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  payout_account: string;
  category: string;
  description: string;
  accent: string;
  active: number;
}

export async function getPayment(paymentId: string): Promise<PaymentRow | null> {
  return queryOne<PaymentRow>("SELECT * FROM payment_requests WHERE id = ?", [paymentId]);
}

export async function getPaymentForUser(
  paymentId: string,
  userId: string,
): Promise<PaymentRow | null> {
  return queryOne<PaymentRow>("SELECT * FROM payment_requests WHERE id = ? AND user_id = ?", [
    paymentId,
    userId,
  ]);
}

export async function getAgent(agentId: string): Promise<AgentRow | null> {
  return queryOne<AgentRow>("SELECT * FROM agents WHERE id = ?", [agentId]);
}

export async function getMerchant(merchantId: string): Promise<MerchantRow | null> {
  return queryOne<MerchantRow>("SELECT * FROM merchants WHERE id = ?", [merchantId]);
}

export async function getApproval(approvalId: string): Promise<ApprovalRow | null> {
  return queryOne<ApprovalRow>("SELECT * FROM approvals WHERE id = ?", [approvalId]);
}

export async function getApprovalForPayment(paymentId: string): Promise<ApprovalRow | null> {
  return queryOne<ApprovalRow>("SELECT * FROM approvals WHERE payment_id = ?", [paymentId]);
}

export async function listPayments(input: {
  userId: string;
  limit?: number;
  offset?: number;
  status?: string | null;
  merchantId?: string | null;
  agentId?: string | null;
}): Promise<PaymentRow[]> {
  const clauses = ["user_id = ?"];
  const params: Array<string | number> = [input.userId];
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  if (input.merchantId) {
    clauses.push("merchant_id = ?");
    params.push(input.merchantId);
  }
  if (input.agentId) {
    clauses.push("agent_id = ?");
    params.push(input.agentId);
  }
  params.push(input.limit ?? 50, input.offset ?? 0);
  return query<PaymentRow>(
    `SELECT * FROM payment_requests WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export interface ReceiptSummary {
  key: string;
  url: string | null;
}

/**
 * Writes the settlement receipt JSON to Neon Object Storage and records the
 * object key on the settlement row. Idempotent: an existing key is reused.
 * Storage failure never changes the payment state; it only leaves the receipt
 * absent, and a later page view retries.
 */
export async function ensureReceipt(paymentId: string): Promise<string | null> {
  if (!storageConfigured()) return null;
  const detail = await paymentDetail(paymentId);
  if (!detail) return null;
  const { payment, merchant, agent, settlement } = detail;
  if (payment.status !== "succeeded" || !settlement) return null;
  if (settlement.receipt_key) return settlement.receipt_key;

  const key = receiptObjectKey(payment.id);
  const receipt = {
    schema: "agentspend.receipt.v1",
    paymentId: payment.id,
    status: payment.status,
    createdAt: new Date(payment.created_at).toISOString(),
    generatedAt: new Date().toISOString(),
    rail: payment.rail,
    enforcement:
      payment.rail === "testnet"
        ? "NEAR testnet vault contract + backend pre-check"
        : "Application backend only (mock rail). No chain transaction was produced.",
    network: payment.network,
    asset: {
      symbol: payment.asset,
      label: appConfig.token.label,
      decimals: appConfig.token.decimals,
      isCircleUsdc: appConfig.token.isCircleUsdc,
      note: "TESTUSD is a demo NEP-141 token. It is not Circle USDC and has no monetary value.",
    },
    amounts: {
      unit: "base units (6 decimals)",
      gross: payment.amount_gross,
      userFee: payment.user_fee,
      merchantFee: payment.merchant_fee,
      net: payment.amount_net,
    },
    merchant: merchant
      ? { id: merchant.id, name: merchant.name, payout: merchant.payout_account }
      : null,
    agent: agent ? { id: agent.id, name: agent.name } : null,
    policy: payment.policy_id ? { id: payment.policy_id, name: detail.policyName } : null,
    settlement: {
      txHash: settlement.tx_hash,
      settlementRef: payment.settlement_ref,
      finality: settlement.finality,
      chainStatus: payment.chain_status,
      verifiedAt: settlement.verified_at
        ? new Date(settlement.verified_at).toISOString()
        : null,
    },
    feesCharged: true,
  };

  try {
    await putJsonObject(key, receipt);
    await execute("UPDATE settlements SET receipt_key = ? WHERE payment_id = ?", [
      key,
      payment.id,
    ]);
    return key;
  } catch (error) {
    console.error(
      "[storage] receipt upload failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/** Presigns the receipt for the transaction page. Scoped to the owner. */
export async function receiptDownloadUrl(
  paymentId: string,
  userId: string,
): Promise<string | null> {
  if (!storageConfigured()) return null;
  const detail = await paymentDetail(paymentId, userId);
  if (!detail || detail.payment.status !== "succeeded") return null;
  const key = await ensureReceipt(paymentId);
  if (!key) return null;
  try {
    return await presignObject(key);
  } catch (error) {
    console.error(
      "[storage] receipt presign failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function paymentCount(userId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM payment_requests WHERE user_id = ?",
    [userId],
  );
  return row?.count ?? 0;
}

export interface PaymentDetail {
  payment: PaymentRow;
  merchant: MerchantRow | null;
  agent: AgentRow | null;
  policyName: string | null;
  approval: ApprovalRow | null;
  fees: Array<{ kind: string; amount: string; status: string }>;
  settlement: {
    tx_hash: string | null;
    receipt_id: string | null;
    receipt_key: string | null;
    finality: string;
    amount_net: string;
    payout: string;
    asset: string;
    network: string;
    verified_at: number | null;
  } | null;
  timeline: Array<{
    id: string;
    actor: string;
    event_type: string;
    detail: string;
    created_at: number;
  }>;
  attempts: Array<{
    id: string;
    attempt_no: number;
    rail: string;
    tx_hash: string | null;
    status: string;
    created_at: number;
  }>;
}

export async function paymentDetail(
  paymentId: string,
  userId?: string,
): Promise<PaymentDetail | null> {
  const payment = userId
    ? await getPaymentForUser(paymentId, userId)
    : await getPayment(paymentId);
  if (!payment) return null;
  const merchant = await getMerchant(payment.merchant_id);
  const agent = payment.agent_id ? await getAgent(payment.agent_id) : null;
  const policy = payment.policy_id ? await loadPolicyById(payment.policy_id) : null;
  const approval = await getApprovalForPayment(payment.id);
  const fees = await query<{ kind: string; amount: string; status: string }>(
    "SELECT kind, amount, status FROM fee_ledger_entries WHERE payment_id = ? ORDER BY kind",
    [payment.id],
  );
  const settlement = await queryOne<NonNullable<PaymentDetail["settlement"]>>(
    `SELECT tx_hash, receipt_id, receipt_key, finality, amount_net, payout, asset, network, verified_at
     FROM settlements WHERE payment_id = ?`,
    [payment.id],
  );
  const timeline = await query<PaymentDetail["timeline"][number]>(
    `SELECT id, actor, event_type, detail, created_at FROM audit_events
     WHERE payment_id = ? ORDER BY created_at ASC`,
    [payment.id],
  );
  const attempts = await query<PaymentDetail["attempts"][number]>(
    `SELECT id, attempt_no, rail, tx_hash, status, created_at FROM payment_attempts
     WHERE payment_id = ? ORDER BY attempt_no ASC`,
    [payment.id],
  );
  return {
    payment,
    merchant,
    agent,
    policyName: policy?.row.name ?? null,
    approval,
    fees,
    settlement: settlement ?? null,
    timeline,
    attempts,
  };
}

function railFor(vault: VaultRow): PaymentRail {
  return vault.rail === "testnet" ? testnetRail : mockRail;
}

async function setPaymentStatus(
  paymentId: string,
  to: PaymentStatus,
  fields: Partial<PaymentRow> = {},
): Promise<PaymentRow> {
  const row = await getPayment(paymentId);
  if (!row) throw new Error("payment not found");
  if (row.status === to) {
    if (Object.keys(fields).length === 0) return row;
  } else {
    if (isTerminal(row.status)) {
      throw new Error(`refusing to move terminal payment ${paymentId} from ${row.status} to ${to}`);
    }
    if (!canTransition(row.status, to)) {
      throw new Error(`illegal payment transition ${row.status} -> ${to}`);
    }
  }
  const assignments: string[] = ["status = ?", "updated_at = ?"];
  const values: Array<string | number | null> = [to, now()];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "id" || key === "status") continue;
    assignments.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  values.push(paymentId);
  await execute(`UPDATE payment_requests SET ${assignments.join(", ")} WHERE id = ?`, values);
  const fresh = await getPayment(paymentId);
  if (!fresh) throw new Error("payment not found after status update");
  return fresh;
}

async function releaseReservation(paymentId: string): Promise<void> {
  await execute(
    `UPDATE budget_reservations SET status = 'released', released_at = ?
     WHERE payment_id = ? AND status = 'held'`,
    [now(), paymentId],
  );
}

async function commitReservation(paymentId: string): Promise<void> {
  await execute(
    `UPDATE budget_reservations SET status = 'committed'
     WHERE payment_id = ? AND status = 'held'`,
    [paymentId],
  );
}

async function insertReservation(input: {
  paymentId: string;
  policyId: string;
  gross: bigint;
  debit: bigint;
}): Promise<void> {
  await execute(
    `INSERT INTO budget_reservations (id, payment_id, policy_id, amount_gross, amount_debit,
      status, created_at) VALUES (?, ?, ?, ?, ?, 'held', ?)`,
    [
      randomId("res_"),
      input.paymentId,
      input.policyId,
      input.gross.toString(),
      input.debit.toString(),
      now(),
    ],
  );
}

async function feeEntries(input: {
  paymentId: string;
  userFee: bigint;
  merchantFee: bigint;
  status: "collected" | "owed";
}): Promise<void> {
  for (const [kind, amount] of [
    ["user_fee", input.userFee],
    ["merchant_fee", input.merchantFee],
  ] as const) {
    await execute(
      `INSERT INTO fee_ledger_entries (id, payment_id, kind, amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_id, kind) DO UPDATE SET amount = excluded.amount, status = excluded.status`,
      [randomId("fee_"), input.paymentId, kind, amount.toString(), input.status, now()],
    );
  }
}

async function updateVaultBalance(vault: VaultRow, deltaDebit: bigint): Promise<void> {
  if (vault.rail !== "testnet") {
    const next = BigInt(vault.balance) - deltaDebit;
    await execute("UPDATE vaults SET balance = ? WHERE id = ?", [
      (next > 0n ? next : 0n).toString(),
      vault.id,
    ]);
  }
}

async function linkMerchantRequest(
  merchantRequestId: string | null,
  paymentId: string,
  status: "processing" | "paid" | "open" | "unknown",
): Promise<void> {
  if (!merchantRequestId) return;
  await execute(
    "UPDATE merchant_requests SET status = ?, payment_id = ?, paid_at = ? WHERE id = ?",
    [status, status === "open" ? null : paymentId, status === "paid" ? now() : null, merchantRequestId],
  );
}

export async function sweepExpiredApprovals(userId?: string): Promise<number> {
  return withTransaction(async () => {
    const params: Array<string | number> = [now(), now()];
    let userClause = "";
    if (userId) {
      userClause = " AND pr.user_id = ?";
      params.push(userId);
    }
    const rows = await query<{
      id: string;
      payment_id: string;
      payment_status: string;
      request_expiry: number;
    }>(
      `SELECT a.id, a.payment_id, pr.status AS payment_status, pr.request_expiry
       FROM approvals a JOIN payment_requests pr ON pr.id = a.payment_id
       WHERE a.status = 'pending' AND (a.expires_at <= ? OR pr.request_expiry <= ?)${userClause}`,
      params,
    );
    let count = 0;
    for (const row of rows) {
      await execute("UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?", [
        now(),
        row.id,
      ]);
      if (row.payment_status === "awaiting_approval") {
        await setPaymentStatus(row.payment_id, "expired");
        await releaseReservation(row.payment_id);
        const payment = await getPayment(row.payment_id);
        if (payment) await linkMerchantRequest(payment.merchant_request_id, payment.id, "open");
        await audit({
          userId: payment?.user_id,
          paymentId: row.payment_id,
          actor: "system",
          eventType: "approval.expired",
          detail: {},
        });
      }
      count += 1;
    }
    return count;
  });
}

export interface CreatePaymentInput {
  userId: string;
  agentId: string;
  merchantId: string;
  serviceId?: string | null;
  amountGross?: bigint | null;
  idempotencyKey: string;
  requestExpiry?: number;
  simulateFailure?: boolean;
  merchantRequestId?: string | null;
  actor: "agent" | "user";
}

export interface CreatePaymentResult {
  payment: PaymentRow;
  approval: ApprovalRow | null;
  replayed: boolean;
}

function validateIdempotencyKey(key: string): void {
  if (!key || key.length > appConfig.limits.maxIdempotencyKeyLength) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 1-128 characters.");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ApiError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key may contain letters, digits, dot, underscore, colon and hyphen.",
    );
  }
}

export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  validateIdempotencyKey(input.idempotencyKey);
  await sweepExpiredApprovals(input.userId);

  // The on-chain vault is the authority for live funds. Mirror its balance
  // before the backend pre-check so a stale local number cannot authorize a
  // payment the contract would reject.
  const preflightAgent = await getAgent(input.agentId);
  if (preflightAgent?.vault_id) {
    const preflightVault = await vaultById(preflightAgent.vault_id);
    if (preflightVault?.rail === "testnet") {
      await syncVaultBalance(preflightVault.id);
    }
  }

  const planned = await withTransaction(
    async (): Promise<CreatePaymentResult | { executeId: string }> => {
      // Serialize payment creation per agent. This replaces SQLite's
      // BEGIN IMMEDIATE serialization and keeps the budget pre-check and its
      // reservation in one critical section across all app instances.
      await execute("SELECT pg_advisory_xact_lock(hashtext(?))", [`agent:${input.agentId}`]);

      const existing = await queryOne<PaymentRow>(
        "SELECT * FROM payment_requests WHERE agent_id = ? AND idempotency_key = ?",
        [input.agentId, input.idempotencyKey],
      );
      if (existing) {
        return {
          payment: existing,
          approval: await getApprovalForPayment(existing.id),
          replayed: true,
        };
      }

      const agent = await getAgent(input.agentId);
      if (!agent || agent.user_id !== input.userId) {
        throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
      }
      if (agent.status !== "active") {
        throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked.");
      }
      const vault = agent.vault_id ? await vaultById(agent.vault_id) : null;
      if (!vault) throw new ApiError(409, "VAULT_NOT_FOUND", "The agent has no vault.");

      const merchant = await getMerchant(input.merchantId);
      if (!merchant || merchant.active !== 1) {
        throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant not found or inactive.");
      }

      let serviceId = input.serviceId ?? null;
      let gross = input.amountGross ?? null;
      if (serviceId) {
        const service = await queryOne<{
          id: string;
          price: string;
          asset: string;
          network: string;
        }>("SELECT * FROM merchant_services WHERE id = ? AND merchant_id = ? AND active = 1", [
          serviceId,
          merchant.id,
        ]);
        if (!service) {
          throw new ApiError(404, "SERVICE_NOT_FOUND", "Service not found for this merchant.");
        }
        if (gross === null) gross = BigInt(service.price);
        else if (gross !== BigInt(service.price)) {
          throw new ApiError(
            400,
            "PRICE_MISMATCH",
            "The amount does not match the registered service price.",
          );
        }
        if (service.asset !== appConfig.token.symbol || service.network !== appConfig.network) {
          throw new ApiError(409, "ASSET_NOT_SUPPORTED", "This service is not priced in the supported asset.");
        }
      } else {
        serviceId = null;
      }
      if (gross === null || gross <= 0n) {
        throw new ApiError(400, "AMOUNT_REQUIRED", "A positive amount or a service id is required.");
      }

      const policy = await loadPolicyForVault(vault.id);
      if (!policy) throw new ApiError(409, "POLICY_NOT_FOUND", "This vault has no active policy.");

      if (input.merchantRequestId) {
        const request = await queryOne<{
          id: string;
          status: string;
          amount: string;
          service_id: string;
          request_expiry: number;
          payment_id: string | null;
        }>("SELECT * FROM merchant_requests WHERE id = ? AND merchant_id = ?", [
          input.merchantRequestId,
          merchant.id,
        ]);
        if (!request) throw new ApiError(404, "MERCHANT_REQUEST_NOT_FOUND", "Payment request not found.");
        if (request.status === "paid") {
          throw new ApiError(409, "ALREADY_PAID", "This merchant payment request is already paid.");
        }
        if (request.status !== "open") {
          throw new ApiError(409, "REQUEST_NOT_OPEN", "This merchant payment request is not open.");
        }
        if (request.request_expiry < now()) {
          throw new ApiError(410, "REQUEST_EXPIRED", "This merchant payment request has expired.");
        }
        if (BigInt(request.amount) !== gross) {
          throw new ApiError(400, "PRICE_MISMATCH", "The amount does not match the merchant request.");
        }
        if (serviceId && serviceId !== request.service_id) {
          throw new ApiError(400, "SERVICE_MISMATCH", "The service does not match the merchant request.");
        }
        serviceId = request.service_id;
      }

      const requestExpiry = input.requestExpiry ?? now() + appConfig.paymentRequestTtlMs;
      if (requestExpiry <= now()) {
        throw new ApiError(400, "REQUEST_EXPIRED", "request_expiry must be in the future.");
      }
      if (requestExpiry > now() + appConfig.maxPaymentRequestTtlMs) {
        throw new ApiError(
          400,
          "REQUEST_EXPIRY_TOO_FAR",
          "request_expiry may be at most one hour in the future.",
        );
      }

      const ruleRow = ruleForMerchant(policy, merchant.id);
      const rule = ruleRow ? coreMerchantRule(ruleRow) : null;
      const usage = await usageForPolicy({
        policyId: policy.row.id,
        now: now(),
        merchantId: merchant.id,
        windowSecs: ruleRow?.window_secs ?? 0,
      });
      const paymentId = randomId("pay_");
      const decision: PolicyDecision = evaluatePayment({
        policy: corePolicy(policy.row),
        agentStatus: agent.status === "active" ? "active" : "revoked",
        merchantRule: rule,
        merchantId: merchant.id,
        paymentId,
        gross,
        requestExpiry,
        now: now(),
        usage,
        approval: null,
        selectedMerchantIds: policy.selectedMerchantIds,
      });

      const amounts = decision.amounts ?? {
        gross,
        userFee: 0n,
        merchantFee: 0n,
        net: 0n,
        debit: 0n,
      };
      const status: PaymentStatus =
        decision.decision === "DENY"
          ? "denied"
          : decision.decision === "REQUIRES_APPROVAL"
            ? "awaiting_approval"
            : "authorized";
      const timestamp = now();
      await execute(
        `INSERT INTO payment_requests (id, user_id, agent_id, policy_id, merchant_id, service_id,
          merchant_request_id, amount_gross, user_fee, merchant_fee, amount_net, asset, network,
          status, decision, deny_code, deny_message, approval_id, idempotency_key, request_expiry,
          rail, simulate_failure, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          input.userId,
          agent.id,
          policy.row.id,
          merchant.id,
          serviceId,
          input.merchantRequestId ?? null,
          amounts.gross.toString(),
          amounts.userFee.toString(),
          amounts.merchantFee.toString(),
          amounts.net.toString(),
          appConfig.token.symbol,
          appConfig.network,
          status,
          decision.decision,
          decision.decision === "DENY" ? decision.code : null,
          decision.decision === "DENY" ? decision.message : null,
          input.idempotencyKey,
          requestExpiry,
          vault.rail,
          input.simulateFailure ? 1 : 0,
          timestamp,
          timestamp,
        ],
      );

      await audit({
        userId: input.userId,
        paymentId,
        actor: input.actor,
        eventType: "policy.evaluated",
        detail: {
          decision: decision.decision,
          explanation:
            decision.decision === "DENY" ? decision.message : decision.explanation,
          merchantId: merchant.id,
          gross: gross.toString(),
          policyVersion: policy.row.version,
        },
      });

      if (decision.decision === "DENY") {
        await audit({
          userId: input.userId,
          paymentId,
          actor: "system",
          eventType: "payment.denied",
          detail: { code: decision.code, message: decision.message },
        });
        await linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "open");
        const payment = await getPayment(paymentId);
        if (!payment) throw new Error("payment disappeared after insert");
        return { payment, approval: null, replayed: false };
      }

      await insertReservation({
        paymentId,
        policyId: policy.row.id,
        gross: amounts.gross,
        debit: amounts.debit,
      });

      if (decision.decision === "REQUIRES_APPROVAL") {
        const approvalId = randomId("apr_");
        const expiresAt = Math.min(now() + appConfig.approvalTtlMs, requestExpiry);
        await execute(
          `INSERT INTO approvals (id, payment_id, policy_id, approval_hash, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
          [approvalId, paymentId, policy.row.id, decision.approvalHash, expiresAt, now()],
        );
        await execute("UPDATE payment_requests SET approval_id = ? WHERE id = ?", [
          approvalId,
          paymentId,
        ]);
        await audit({
          userId: input.userId,
          paymentId,
          actor: "system",
          eventType: "approval.requested",
          detail: {
            approvalId,
            reason: decision.reason,
            approvalHash: decision.approvalHash,
            expiresAt,
          },
        });
        await linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "processing");
        const payment = await getPayment(paymentId);
        if (!payment) throw new Error("payment disappeared after insert");
        return { payment, approval: await getApproval(approvalId), replayed: false };
      }

      await audit({
        userId: input.userId,
        paymentId,
        actor: "system",
        eventType: "payment.authorized",
        detail: { explanation: decision.explanation, approvalHash: decision.approvalHash },
      });
      await linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "processing");
      return { executeId: paymentId };
    },
  );

  if ("executeId" in planned) {
    const payment = await executeAuthorizedPayment(planned.executeId);
    return {
      payment,
      approval: await getApprovalForPayment(payment.id),
      replayed: false,
    };
  }

  if (planned.replayed && planned.payment.status === "authorized") {
    const payment = await executeAuthorizedPayment(planned.payment.id);
    return { payment, approval: planned.approval, replayed: true };
  }

  if (!planned.replayed && planned.payment.status === "denied") {
    await emitMerchantEvent({
      merchantId: planned.payment.merchant_id,
      paymentId: planned.payment.id,
      eventType: "payment.denied",
      data: {
        paymentId: planned.payment.id,
        status: "denied",
        reason: planned.payment.deny_code,
        gross: planned.payment.amount_gross,
      },
    });
  }
  if (!planned.replayed && planned.payment.status === "awaiting_approval") {
    await emitMerchantEvent({
      merchantId: planned.payment.merchant_id,
      paymentId: planned.payment.id,
      eventType: "payment.approval_required",
      data: {
        paymentId: planned.payment.id,
        status: "awaiting_approval",
        gross: planned.payment.amount_gross,
      },
    });
  }
  return planned;
}

async function claimForExecution(paymentId: string): Promise<boolean> {
  return withTransaction(async () => {
    const row = await getPayment(paymentId);
    if (!row || row.status !== "authorized") return false;
    await setPaymentStatus(paymentId, "submitted");
    await audit({
      userId: row.user_id,
      paymentId,
      actor: "system",
      eventType: "payment.submitted",
      detail: { rail: row.rail },
    });
    return true;
  });
}

export async function executeAuthorizedPayment(paymentId: string): Promise<PaymentRow> {
  if (!(await claimForExecution(paymentId))) {
    const row = await getPayment(paymentId);
    if (!row) throw new Error("payment not found");
    return row;
  }

  const payment = await getPayment(paymentId);
  if (!payment) throw new Error("payment not found");
  const policyVault = payment.policy_id
    ? await queryOne<{ vault_id: string | null }>("SELECT vault_id FROM policies WHERE id = ?", [
        payment.policy_id,
      ])
    : null;
  const vault = policyVault?.vault_id ? await vaultById(policyVault.vault_id) : null;
  const agent = payment.agent_id ? await getAgent(payment.agent_id) : null;
  const merchant = await getMerchant(payment.merchant_id);
  if (!vault || !agent || !merchant) {
    return failPayment(paymentId, "Vault, agent or merchant disappeared before execution.");
  }

  const attemptCount = await queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM payment_attempts WHERE payment_id = ?",
    [paymentId],
  );
  const attemptNo = (attemptCount?.count ?? 0) + 1;
  const attemptId = randomId("att_");
  await execute(
    `INSERT INTO payment_attempts (id, payment_id, attempt_no, rail, request_payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
    [
      attemptId,
      paymentId,
      attemptNo,
      vault.rail,
      JSON.stringify({
        paymentId,
        merchantId: payment.merchant_id,
        payout: merchant.payout_account,
        gross: payment.amount_gross,
        net: payment.amount_net,
      }),
      now(),
    ],
  );

  const rail = railFor(vault);
  let result;
  try {
    result = await rail.execute({
      paymentId,
      vault,
      merchantId: payment.merchant_id,
      payoutAccount: merchant.payout_account,
      gross: BigInt(payment.amount_gross),
      userFee: BigInt(payment.user_fee),
      merchantFee: BigInt(payment.merchant_fee),
      net: BigInt(payment.amount_net),
      requestExpiry: payment.request_expiry,
      agent: { id: agent.id, name: agent.name },
      simulateFailure: payment.simulate_failure === 1,
    });
  } catch (error) {
    result = {
      outcome: "unknown" as const,
      txHash: null,
      chainStatus: "exception",
      settlementRef: null,
      verified: false,
      feeCollected: false,
      error: error instanceof Error ? error.message : "rail threw an exception",
      raw: null,
    };
  }

  await execute(
    "UPDATE payment_attempts SET status = ?, response_payload = ?, tx_hash = ? WHERE id = ?",
    [result.outcome, JSON.stringify(result.raw ?? { error: result.error }), result.txHash, attemptId],
  );

  if (result.outcome === "failed") {
    return failPayment(paymentId, result.error ?? "settlement failed", result.txHash);
  }

  if (result.outcome === "unknown") {
    await withTransaction(async () => {
      const row = await getPayment(paymentId);
      if (!row) throw new Error("payment not found");
      if (row.status === "submitted") await setPaymentStatus(paymentId, "confirming");
      await setPaymentStatus(paymentId, "unknown", {
        tx_hash: result.txHash,
        chain_status: result.chainStatus,
        error: result.error,
      });
      await audit({
        userId: row.user_id,
        paymentId,
        actor: "chain",
        eventType: "payment.unknown",
        detail: { error: result.error, txHash: result.txHash },
      });
    });
    await emitMerchantEvent({
      merchantId: payment.merchant_id,
      paymentId,
      eventType: "payment.unknown",
      data: { paymentId, status: "unknown", gross: payment.amount_gross },
    });
    const row = await getPayment(paymentId);
    if (!row) throw new Error("payment not found");
    return row;
  }

  const settled = await withTransaction(async () => {
    const row = await getPayment(paymentId);
    if (!row) throw new Error("payment not found");
    if (row.status === "submitted") await setPaymentStatus(paymentId, "confirming");
    await setPaymentStatus(paymentId, "succeeded", {
      tx_hash: result.txHash,
      chain_status: result.chainStatus,
      settlement_ref: result.settlementRef,
      error: null,
    });
    await commitReservation(paymentId);
    await execute(
      `INSERT INTO settlements (id, payment_id, rail, tx_hash, receipt_id, finality, amount_net,
        payout, asset, network, verified_at, raw, created_at)
       VALUES (?, ?, ?, ?, NULL, 'FINAL', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_id) DO UPDATE SET
         tx_hash = excluded.tx_hash, finality = excluded.finality, amount_net = excluded.amount_net,
         payout = excluded.payout, verified_at = excluded.verified_at, raw = excluded.raw`,
      [
        randomId("set_"),
        paymentId,
        vault.rail,
        result.txHash,
        row.amount_net,
        merchant.payout_account,
        row.asset,
        row.network,
        now(),
        JSON.stringify(result.raw ?? {}),
        now(),
      ],
    );
    await feeEntries({
      paymentId,
      userFee: BigInt(row.user_fee),
      merchantFee: BigInt(row.merchant_fee),
      status: result.feeCollected ? "collected" : "owed",
    });
    await updateVaultBalance(vault, BigInt(row.amount_gross) + BigInt(row.user_fee));
    await linkMerchantRequest(row.merchant_request_id, paymentId, "paid");
    await audit({
      userId: row.user_id,
      paymentId,
      actor: "chain",
      eventType: "payment.succeeded",
      detail: {
        txHash: result.txHash,
        settlementRef: result.settlementRef,
        verified: result.verified,
        feeCollected: result.feeCollected,
      },
    });
    await audit({
      userId: row.user_id,
      paymentId,
      actor: "system",
      eventType: "fee.recorded",
      detail: {
        userFee: row.user_fee,
        merchantFee: row.merchant_fee,
        status: result.feeCollected ? "collected" : "owed",
      },
    });
    const fresh = await getPayment(paymentId);
    if (!fresh) throw new Error("payment not found after settlement");
    return fresh;
  });

  if (vault.rail === "testnet") {
    void syncVaultBalance(vault.id);
  }
  await ensureReceipt(settled.id);
  await emitMerchantEvent({
    merchantId: settled.merchant_id,
    paymentId: settled.id,
    eventType: "payment.succeeded",
    data: {
      paymentId: settled.id,
      status: "succeeded",
      gross: settled.amount_gross,
      merchantFee: settled.merchant_fee,
      net: settled.amount_net,
      settlementRef: settled.settlement_ref,
      txHash: settled.tx_hash,
      asset: settled.asset,
      network: settled.network,
    },
  });
  return settled;
}

async function failPayment(
  paymentId: string,
  error: string,
  txHash: string | null = null,
): Promise<PaymentRow> {
  const settled = await withTransaction(async () => {
    const row = await getPayment(paymentId);
    if (!row) throw new Error("payment not found");
    if (row.status === "submitted") {
      await setPaymentStatus(paymentId, "failed", {
        tx_hash: txHash,
        chain_status: "failed",
        error,
      });
    } else if (row.status === "confirming") {
      await setPaymentStatus(paymentId, "failed", {
        tx_hash: txHash,
        chain_status: "failed",
        error,
      });
    } else if (row.status === "authorized") {
      await setPaymentStatus(paymentId, "failed", {
        tx_hash: txHash,
        chain_status: "failed",
        error,
      });
    } else if (row.status !== "failed") {
      throw new Error(`cannot fail payment in status ${row.status}`);
    }
    await releaseReservation(paymentId);
    await linkMerchantRequest(row.merchant_request_id, paymentId, "open");
    await audit({
      userId: row.user_id,
      paymentId,
      actor: "chain",
      eventType: "payment.failed",
      detail: { error, txHash },
    });
    const fresh = await getPayment(paymentId);
    if (!fresh) throw new Error("payment not found after failure");
    return fresh;
  });
  await emitMerchantEvent({
    merchantId: settled.merchant_id,
    paymentId,
    eventType: "payment.failed",
    data: {
      paymentId,
      status: "failed",
      gross: settled.amount_gross,
      error,
    },
  });
  return settled;
}

export interface ApproveResult {
  payment: PaymentRow;
  approval: ApprovalRow;
}

export async function approvePayment(input: {
  approvalId: string;
  userId: string;
}): Promise<ApproveResult> {
  await sweepExpiredApprovals(input.userId);
  const claimed = await withTransaction(async () => {
    const approval = await getApproval(input.approvalId);
    if (!approval) throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    const payment = await getPayment(approval.payment_id);
    if (!payment || payment.user_id !== input.userId) {
      throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    }
    if (approval.status !== "pending") {
      throw new ApiError(409, "APPROVAL_NOT_PENDING", "This approval is no longer pending.");
    }
    if (approval.expires_at <= now() || payment.request_expiry <= now()) {
      throw new ApiError(410, "APPROVAL_EXPIRED", "This approval has expired.");
    }
    if (payment.status !== "awaiting_approval") {
      throw new ApiError(409, "PAYMENT_NOT_AWAITING", "This payment is not awaiting approval.");
    }
    await execute("UPDATE approvals SET status = 'approving' WHERE id = ?", [approval.id]);
    return { approval, payment };
  });

  const policy = await loadPolicyById(claimed.approval.policy_id);
  if (!policy) throw new ApiError(409, "POLICY_NOT_FOUND", "Policy not found.");
  const vault = policy.row.vault_id ? await vaultById(policy.row.vault_id) : null;
  if (!vault) throw new ApiError(409, "VAULT_NOT_FOUND", "Vault not found.");
  const agent = claimed.payment.agent_id ? await getAgent(claimed.payment.agent_id) : null;
  const merchant = await getMerchant(claimed.payment.merchant_id);
  if (!agent || !merchant) {
    await withTransaction(async () => {
      await execute("UPDATE approvals SET status = 'pending' WHERE id = ?", [claimed.approval.id]);
    });
    throw new ApiError(409, "PAYMENT_INCOMPLETE", "Payment is missing its agent or merchant.");
  }

  const approvalExpiry = Math.min(now() + appConfig.approvalTtlMs, claimed.payment.request_expiry);
  let txHash: string | null = null;
  try {
    txHash = await approveOnVault({
      policyId: policy.row.id,
      paymentId: claimed.payment.id,
      merchantId: claimed.payment.merchant_id,
      gross: claimed.payment.amount_gross,
      requestExpiry: claimed.payment.request_expiry,
      approvalExpiry,
    });
  } catch (error) {
    await withTransaction(async () => {
      await execute("UPDATE approvals SET status = 'pending' WHERE id = ?", [claimed.approval.id]);
    });
    throw new ApiError(
      502,
      "APPROVAL_CHAIN_FAILED",
      error instanceof Error ? error.message : "The on-chain approval failed.",
    );
  }

  const approvalRef: ApprovalRef = {
    hash: claimed.approval.approval_hash,
    paymentId: claimed.payment.id,
    merchantId: claimed.payment.merchant_id,
    gross: BigInt(claimed.payment.amount_gross),
    requestExpiry: claimed.payment.request_expiry,
    policyVersion: policy.row.version,
    expiresAt: claimed.approval.expires_at,
  };
  const usage = await usageForPolicy({
    policyId: policy.row.id,
    now: now(),
    merchantId: claimed.payment.merchant_id,
    windowSecs: ruleForMerchant(policy, claimed.payment.merchant_id)?.window_secs ?? 0,
    excludePaymentId: claimed.payment.id,
  });
  const ruleRow = ruleForMerchant(policy, claimed.payment.merchant_id);
  const decision = evaluatePayment({
    policy: corePolicy(policy.row),
    agentStatus: agent.status === "active" ? "active" : "revoked",
    merchantRule: ruleRow ? coreMerchantRule(ruleRow) : null,
    merchantId: claimed.payment.merchant_id,
    paymentId: claimed.payment.id,
    gross: BigInt(claimed.payment.amount_gross),
    requestExpiry: claimed.payment.request_expiry,
    now: now(),
    usage,
    approval: approvalRef,
    selectedMerchantIds: policy.selectedMerchantIds,
  });

  if (decision.decision !== "ALLOW") {
    return withTransaction(async () => {
      await setPaymentStatus(claimed.payment.id, "denied", {
        decision: "DENY",
        deny_code: decision.decision === "DENY" ? decision.code : "APPROVAL_EXPIRED",
        deny_message:
          decision.decision === "DENY"
            ? decision.message
            : "The policy changed after approval. Request a new approval.",
      });
      await releaseReservation(claimed.payment.id);
      await execute(
        "UPDATE approvals SET status = 'approved', decided_at = ?, tx_hash = ? WHERE id = ?",
        [now(), txHash, claimed.approval.id],
      );
      await audit({
        userId: input.userId,
        paymentId: claimed.payment.id,
        actor: "user",
        eventType: "payment.denied_after_approval",
        detail: { decision: decision.decision },
      });
      const payment = await getPayment(claimed.payment.id);
      const approval = await getApproval(claimed.approval.id);
      if (!payment || !approval) throw new Error("payment or approval disappeared");
      return { payment, approval };
    });
  }

  await withTransaction(async () => {
    await setPaymentStatus(claimed.payment.id, "authorized", {
      decision: "ALLOW",
      deny_code: null,
      deny_message: null,
    });
    await execute(
      "UPDATE approvals SET status = 'approved', decided_at = ?, tx_hash = ? WHERE id = ?",
      [now(), txHash, claimed.approval.id],
    );
    await audit({
      userId: input.userId,
      paymentId: claimed.payment.id,
      actor: "user",
      eventType: "approval.approved",
      detail: { txHash, approvalHash: claimed.approval.approval_hash },
    });
  });

  const payment = await executeAuthorizedPayment(claimed.payment.id);
  const approval = await getApproval(claimed.approval.id);
  if (!approval) throw new Error("approval disappeared");
  return { payment, approval };
}

export async function denyPayment(input: {
  approvalId: string;
  userId: string;
}): Promise<{
  payment: PaymentRow;
  approval: ApprovalRow;
}> {
  return withTransaction(async () => {
    const approval = await getApproval(input.approvalId);
    if (!approval) throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    const payment = await getPayment(approval.payment_id);
    if (!payment || payment.user_id !== input.userId) {
      throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    }
    if (approval.status !== "pending") {
      throw new ApiError(409, "APPROVAL_NOT_PENDING", "This approval is no longer pending.");
    }
    if (payment.status !== "awaiting_approval") {
      throw new ApiError(409, "PAYMENT_NOT_AWAITING", "This payment is not awaiting approval.");
    }
    await execute("UPDATE approvals SET status = 'denied', decided_at = ? WHERE id = ?", [
      now(),
      approval.id,
    ]);
    await setPaymentStatus(payment.id, "denied", {
      decision: "DENY",
      deny_code: "APPROVAL_DENIED",
      deny_message: "You denied this payment.",
    });
    await releaseReservation(payment.id);
    await linkMerchantRequest(payment.merchant_request_id, payment.id, "open");
    await audit({
      userId: input.userId,
      paymentId: payment.id,
      actor: "user",
      eventType: "approval.denied",
      detail: {},
    });
    const freshPayment = await getPayment(payment.id);
    const freshApproval = await getApproval(approval.id);
    if (!freshPayment || !freshApproval) throw new Error("payment or approval disappeared");
    const result = { payment: freshPayment, approval: freshApproval };
    await emitMerchantEvent({
      merchantId: payment.merchant_id,
      paymentId: payment.id,
      eventType: "payment.denied",
      data: { paymentId: payment.id, status: "denied", reason: "approval_denied" },
    });
    return result;
  });
}

export async function reconcilePayment(paymentId: string): Promise<PaymentRow> {
  const payment = await getPayment(paymentId);
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.status !== "unknown" && payment.status !== "submitted" && payment.status !== "confirming") {
    return payment;
  }
  let vault: VaultRow | null = null;
  if (payment.policy_id) {
    const policy = await loadPolicyById(payment.policy_id);
    vault = policy?.row.vault_id ? await vaultById(policy.row.vault_id) : null;
  }
  if (!vault || vault.rail !== "testnet") {
    throw new ApiError(409, "RECONCILE_UNSUPPORTED", "This payment cannot be reconciled on the mock rail.");
  }
  const { getVaultPayment } = await import("@agentspend/near");
  const vaultPayment = await getVaultPayment(vault.account_id, payment.id);
  if (!vaultPayment) {
    return failPayment(paymentId, "No vault payment record exists. The transaction never reserved funds.");
  }
  if (vaultPayment.status === "Failed") {
    return failPayment(paymentId, "The vault released this reservation because settlement failed.");
  }
  if (vaultPayment.status === "Reserved") {
    return payment;
  }
  const { verifyVaultSettlement, verifyMerchantTransferEvent } = await import("./rails/testnet");
  const merchant = await getMerchant(payment.merchant_id);
  if (!merchant) {
    throw new ApiError(409, "RECONCILE_MERCHANT_MISSING", "The merchant for this payment is unavailable.");
  }
  const settlement = verifyVaultSettlement({
    payment: vaultPayment,
    payout: merchant.payout_account,
    net: BigInt(payment.amount_net),
    gross: BigInt(payment.amount_gross),
    paymentId: payment.id,
  });
  if (!settlement.matches || !settlement.settled) {
    await audit({
      userId: payment.user_id,
      paymentId,
      actor: "system",
      eventType: "payment.reconcile_mismatch",
      detail: { vaultStatus: vaultPayment.status, vaultPayout: vaultPayment.payout },
    });
    return payment;
  }

  let logVerified = false;
  if (payment.tx_hash) {
    try {
      const { getTransactionStatus } = await import("@agentspend/near");
      const logs = (
        await getTransactionStatus({
          txHash: payment.tx_hash,
          accountId: vault.account_id,
        })
      ).logs;
      logVerified = verifyMerchantTransferEvent({
        logs,
        payout: merchant.payout_account,
        net: BigInt(payment.amount_net),
        paymentId: payment.id,
      });
    } catch {
      logVerified = false;
    }
  }

  const reconciled = await withTransaction(async () => {
    const row = await getPayment(paymentId);
    if (!row) throw new Error("payment not found");
    if (row.status === "submitted") await setPaymentStatus(paymentId, "confirming");
    await setPaymentStatus(paymentId, "succeeded", {
      tx_hash: payment.tx_hash,
      chain_status: settlement.feeCollected ? "succeeded" : "merchant_paid_fee_pending",
      settlement_ref: payment.tx_hash ?? `vault:${payment.id}`,
      error: null,
    });
    // A payment recovered from chain state must record the same settlement
    // evidence as a direct settlement, otherwise the receipt and the
    // transaction page lose the authoritative proof.
    await execute(
      `INSERT INTO settlements (id, payment_id, rail, tx_hash, receipt_id, finality, amount_net,
        payout, asset, network, verified_at, raw, created_at)
       VALUES (?, ?, ?, ?, NULL, 'FINAL', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_id) DO UPDATE SET
         tx_hash = excluded.tx_hash, finality = excluded.finality, amount_net = excluded.amount_net,
         payout = excluded.payout, verified_at = excluded.verified_at, raw = excluded.raw`,
      [
        randomId("set_"),
        paymentId,
        vault.rail,
        payment.tx_hash,
        row.amount_net,
        merchant.payout_account,
        row.asset,
        row.network,
        now(),
        JSON.stringify({
          source: "reconcile",
          vaultStatus: vaultPayment.status,
          logVerified,
        }),
        now(),
      ],
    );
    await commitReservation(paymentId);
    await feeEntries({
      paymentId,
      userFee: BigInt(row.user_fee),
      merchantFee: BigInt(row.merchant_fee),
      status: settlement.feeCollected ? "collected" : "owed",
    });
    await updateVaultBalance(vault, BigInt(row.amount_gross) + BigInt(row.user_fee));
    await audit({
      userId: row.user_id,
      paymentId,
      actor: "system",
      eventType: "payment.reconciled",
      detail: { vaultStatus: vaultPayment.status, logVerified },
    });
    const fresh = await getPayment(paymentId);
    if (!fresh) throw new Error("payment not found after reconciliation");
    return fresh;
  });
  await ensureReceipt(reconciled.id);
  return reconciled;
}

export async function pendingApprovals(userId: string): Promise<
  Array<ApprovalRow & { payment: PaymentRow; merchantName: string; agentName: string }>
> {
  await sweepExpiredApprovals(userId);
  const rows = await query<
    ApprovalRow & { merchant_name: string; agent_name: string | null }
  >(
    `SELECT a.*, pr.merchant_id AS p_merchant_id, pr.agent_id AS p_agent_id,
            m.name AS merchant_name, ag.name AS agent_name
     FROM approvals a
     JOIN payment_requests pr ON pr.id = a.payment_id
     JOIN merchants m ON m.id = pr.merchant_id
     LEFT JOIN agents ag ON ag.id = pr.agent_id
     WHERE pr.user_id = ? AND a.status = 'pending'
     ORDER BY a.created_at DESC`,
    [userId],
  );
  const result: Array<
    ApprovalRow & { payment: PaymentRow; merchantName: string; agentName: string }
  > = [];
  for (const row of rows) {
    const payment = await getPayment(row.payment_id);
    if (!payment) continue;
    result.push({
      ...row,
      payment,
      merchantName: row.merchant_name,
      agentName: row.agent_name ?? "Unknown agent",
    });
  }
  return result;
}

export function paymentSummary(payment: PaymentRow): {
  gross: string;
  userFee: string;
  merchantFee: string;
  net: string;
  status: string;
  decision: string | null;
} {
  return {
    gross: formatUsd(BigInt(payment.amount_gross)),
    userFee: formatUsd(BigInt(payment.user_fee)),
    merchantFee: formatUsd(BigInt(payment.merchant_fee)),
    net: formatUsd(BigInt(payment.amount_net)),
    status: payment.status,
    decision: payment.decision,
  };
}

export async function merchantPayments(merchantId: string, limit = 50): Promise<PaymentRow[]> {
  return query<PaymentRow>(
    "SELECT * FROM payment_requests WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?",
    [merchantId, limit],
  );
}

export async function merchantSummary(merchantId: string): Promise<{
  gross: bigint;
  merchantFee: bigint;
  net: bigint;
  count: number;
}> {
  const rows = await query<{
    amount_gross: string;
    merchant_fee: string;
    amount_net: string;
  }>(
    "SELECT amount_gross, merchant_fee, amount_net FROM payment_requests WHERE merchant_id = ? AND status = 'succeeded'",
    [merchantId],
  );
  let gross = 0n;
  let merchantFee = 0n;
  let net = 0n;
  for (const row of rows) {
    gross += BigInt(row.amount_gross);
    merchantFee += BigInt(row.merchant_fee);
    net += BigInt(row.amount_net);
  }
  return { gross, merchantFee, net, count: rows.length };
}

export async function budgetForAgent(agentId: string): Promise<{
  policyId: string;
  totalBudget: bigint;
  remaining: bigint;
  committed: bigint;
  held: bigint;
  balance: bigint;
  available: bigint;
} | null> {
  const agent = await getAgent(agentId);
  if (!agent?.vault_id) return null;
  const policy = await loadPolicyForVault(agent.vault_id);
  if (!policy) return null;
  const summary = await budgetSummary({
    policyId: policy.row.id,
    totalBudget: BigInt(policy.row.total_budget),
    now: now(),
  });
  return {
    policyId: policy.row.id,
    totalBudget: summary.totalBudget,
    remaining: summary.remaining,
    committed: summary.committedGross,
    held: summary.heldGross,
    balance: summary.balance,
    available: summary.availableBalance,
  };
}
