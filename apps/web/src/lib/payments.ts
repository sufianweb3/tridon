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
import { getDb, now, withTransaction } from "./db";
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

export function getPayment(paymentId: string): PaymentRow | null {
  const row = getDb().prepare("SELECT * FROM payment_requests WHERE id = ?").get(paymentId) as
    | PaymentRow
    | undefined;
  return row ?? null;
}

export function getPaymentForUser(paymentId: string, userId: string): PaymentRow | null {
  const row = getDb()
    .prepare("SELECT * FROM payment_requests WHERE id = ? AND user_id = ?")
    .get(paymentId, userId) as PaymentRow | undefined;
  return row ?? null;
}

export function getAgent(agentId: string): AgentRow | null {
  const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
    | AgentRow
    | undefined;
  return row ?? null;
}

export function getMerchant(merchantId: string): MerchantRow | null {
  const row = getDb().prepare("SELECT * FROM merchants WHERE id = ?").get(merchantId) as
    | MerchantRow
    | undefined;
  return row ?? null;
}

export function getApproval(approvalId: string): ApprovalRow | null {
  const row = getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as
    | ApprovalRow
    | undefined;
  return row ?? null;
}

export function getApprovalForPayment(paymentId: string): ApprovalRow | null {
  const row = getDb()
    .prepare("SELECT * FROM approvals WHERE payment_id = ?")
    .get(paymentId) as ApprovalRow | undefined;
  return row ?? null;
}

export function listPayments(input: {
  userId: string;
  limit?: number;
  offset?: number;
  status?: string | null;
  merchantId?: string | null;
  agentId?: string | null;
}): PaymentRow[] {
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
  return getDb()
    .prepare(
      `SELECT * FROM payment_requests WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params) as unknown as PaymentRow[];
}

export function paymentCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM payment_requests WHERE user_id = ?")
    .get(userId) as { count: number };
  return row.count;
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

export function paymentDetail(paymentId: string, userId?: string): PaymentDetail | null {
  const payment = userId
    ? getPaymentForUser(paymentId, userId)
    : getPayment(paymentId);
  if (!payment) return null;
  const merchant = getMerchant(payment.merchant_id);
  const agent = payment.agent_id ? getAgent(payment.agent_id) : null;
  const policy = payment.policy_id ? loadPolicyById(payment.policy_id) : null;
  const approval = getApprovalForPayment(payment.id);
  const fees = getDb()
    .prepare("SELECT kind, amount, status FROM fee_ledger_entries WHERE payment_id = ? ORDER BY kind")
    .all(payment.id) as unknown as Array<{ kind: string; amount: string; status: string }>;
  const settlement = getDb()
    .prepare(
      `SELECT tx_hash, receipt_id, finality, amount_net, payout, asset, network, verified_at
       FROM settlements WHERE payment_id = ?`,
    )
    .get(payment.id) as PaymentDetail["settlement"] | undefined;
  const timeline = getDb()
    .prepare(
      `SELECT id, actor, event_type, detail, created_at FROM audit_events
       WHERE payment_id = ? ORDER BY created_at ASC`,
    )
    .all(payment.id) as unknown as PaymentDetail["timeline"];
  const attempts = getDb()
    .prepare(
      `SELECT id, attempt_no, rail, tx_hash, status, created_at FROM payment_attempts
       WHERE payment_id = ? ORDER BY attempt_no ASC`,
    )
    .all(payment.id) as unknown as PaymentDetail["attempts"];
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

function setPaymentStatus(
  paymentId: string,
  to: PaymentStatus,
  fields: Partial<PaymentRow> = {},
): PaymentRow {
  const row = getPayment(paymentId);
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
  getDb()
    .prepare(`UPDATE payment_requests SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values);
  return getPayment(paymentId)!;
}

function releaseReservation(paymentId: string): void {
  getDb()
    .prepare(
      `UPDATE budget_reservations SET status = 'released', released_at = ?
       WHERE payment_id = ? AND status = 'held'`,
    )
    .run(now(), paymentId);
}

function commitReservation(paymentId: string): void {
  getDb()
    .prepare(
      `UPDATE budget_reservations SET status = 'committed'
       WHERE payment_id = ? AND status = 'held'`,
    )
    .run(paymentId);
}

function insertReservation(input: {
  paymentId: string;
  policyId: string;
  gross: bigint;
  debit: bigint;
}): void {
  getDb()
    .prepare(
      `INSERT INTO budget_reservations (id, payment_id, policy_id, amount_gross, amount_debit,
        status, created_at) VALUES (?, ?, ?, ?, ?, 'held', ?)`,
    )
    .run(
      randomId("res_"),
      input.paymentId,
      input.policyId,
      input.gross.toString(),
      input.debit.toString(),
      now(),
    );
}

function feeEntries(input: {
  paymentId: string;
  userFee: bigint;
  merchantFee: bigint;
  status: "collected" | "owed";
}): void {
  const db = getDb();
  for (const [kind, amount] of [
    ["user_fee", input.userFee],
    ["merchant_fee", input.merchantFee],
  ] as const) {
    db.prepare(
      `INSERT INTO fee_ledger_entries (id, payment_id, kind, amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_id, kind) DO UPDATE SET amount = excluded.amount, status = excluded.status`,
    ).run(randomId("fee_"), input.paymentId, kind, amount.toString(), input.status, now());
  }
}

function updateVaultBalance(vault: VaultRow, deltaDebit: bigint): void {
  if (vault.rail !== "testnet") {
    const next = BigInt(vault.balance) - deltaDebit;
    getDb()
      .prepare("UPDATE vaults SET balance = ? WHERE id = ?")
      .run((next > 0n ? next : 0n).toString(), vault.id);
  }
}

function linkMerchantRequest(
  merchantRequestId: string | null,
  paymentId: string,
  status: "processing" | "paid" | "open" | "unknown",
): void {
  if (!merchantRequestId) return;
  getDb()
    .prepare("UPDATE merchant_requests SET status = ?, payment_id = ?, paid_at = ? WHERE id = ?")
    .run(
      status,
      status === "open" ? null : paymentId,
      status === "paid" ? now() : null,
      merchantRequestId,
    );
}

export function sweepExpiredApprovals(userId?: string): number {
  return withTransaction(() => {
    const params: Array<string | number> = [now(), now()];
    let userClause = "";
    if (userId) {
      userClause = " AND pr.user_id = ?";
      params.push(userId);
    }
    const rows = getDb()
      .prepare(
        `SELECT a.id, a.payment_id, pr.status AS payment_status, pr.request_expiry
         FROM approvals a JOIN payment_requests pr ON pr.id = a.payment_id
         WHERE a.status = 'pending' AND (a.expires_at <= ? OR pr.request_expiry <= ?)${userClause}`,
      )
      .all(...params) as unknown as Array<{
      id: string;
      payment_id: string;
      payment_status: string;
      request_expiry: number;
    }>;
    let count = 0;
    for (const row of rows) {
      getDb()
        .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?")
        .run(now(), row.id);
      if (row.payment_status === "awaiting_approval") {
        setPaymentStatus(row.payment_id, "expired");
        releaseReservation(row.payment_id);
        const payment = getPayment(row.payment_id);
        if (payment) linkMerchantRequest(payment.merchant_request_id, payment.id, "open");
        audit({
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
  sweepExpiredApprovals(input.userId);

  // The on-chain vault is the authority for live funds. Mirror its balance
  // before the backend pre-check so a stale local number cannot authorize a
  // payment the contract would reject.
  const preflightAgent = getAgent(input.agentId);
  if (preflightAgent?.vault_id) {
    const preflightVault = vaultById(preflightAgent.vault_id);
    if (preflightVault?.rail === "testnet") {
      await syncVaultBalance(preflightVault.id);
    }
  }

  const planned = withTransaction((): CreatePaymentResult | { executeId: string } => {
    const existing = getDb()
      .prepare("SELECT * FROM payment_requests WHERE agent_id = ? AND idempotency_key = ?")
      .get(input.agentId, input.idempotencyKey) as PaymentRow | undefined;
    if (existing) {
      return {
        payment: existing,
        approval: getApprovalForPayment(existing.id),
        replayed: true,
      };
    }

    const agent = getAgent(input.agentId);
    if (!agent || agent.user_id !== input.userId) {
      throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
    }
    if (agent.status !== "active") {
      throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked.");
    }
    const vault = agent.vault_id ? vaultById(agent.vault_id) : null;
    if (!vault) throw new ApiError(409, "VAULT_NOT_FOUND", "The agent has no vault.");

    const merchant = getMerchant(input.merchantId);
    if (!merchant || merchant.active !== 1) {
      throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant not found or inactive.");
    }

    let serviceId = input.serviceId ?? null;
    let gross = input.amountGross ?? null;
    if (serviceId) {
      const service = getDb()
        .prepare("SELECT * FROM merchant_services WHERE id = ? AND merchant_id = ? AND active = 1")
        .get(serviceId, merchant.id) as
        | { id: string; price: string; asset: string; network: string }
        | undefined;
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

    const policy = loadPolicyForVault(vault.id);
    if (!policy) throw new ApiError(409, "POLICY_NOT_FOUND", "This vault has no active policy.");

    if (input.merchantRequestId) {
      const request = getDb()
        .prepare("SELECT * FROM merchant_requests WHERE id = ? AND merchant_id = ?")
        .get(input.merchantRequestId, merchant.id) as
        | {
            id: string;
            status: string;
            amount: string;
            service_id: string;
            request_expiry: number;
            payment_id: string | null;
          }
        | undefined;
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

    const requestExpiry =
      input.requestExpiry ?? now() + appConfig.paymentRequestTtlMs;
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
    const usage = usageForPolicy({
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
    getDb()
      .prepare(
        `INSERT INTO payment_requests (id, user_id, agent_id, policy_id, merchant_id, service_id,
          merchant_request_id, amount_gross, user_fee, merchant_fee, amount_net, asset, network,
          status, decision, deny_code, deny_message, approval_id, idempotency_key, request_expiry,
          rail, simulate_failure, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );

    audit({
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
      audit({
        userId: input.userId,
        paymentId,
        actor: "system",
        eventType: "payment.denied",
        detail: { code: decision.code, message: decision.message },
      });
      linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "open");
      return {
        payment: getPayment(paymentId)!,
        approval: null,
        replayed: false,
      };
    }

    insertReservation({
      paymentId,
      policyId: policy.row.id,
      gross: amounts.gross,
      debit: amounts.debit,
    });

    if (decision.decision === "REQUIRES_APPROVAL") {
      const approvalId = randomId("apr_");
      const expiresAt = Math.min(now() + appConfig.approvalTtlMs, requestExpiry);
      getDb()
        .prepare(
          `INSERT INTO approvals (id, payment_id, policy_id, approval_hash, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(approvalId, paymentId, policy.row.id, decision.approvalHash, expiresAt, now());
      getDb()
        .prepare("UPDATE payment_requests SET approval_id = ? WHERE id = ?")
        .run(approvalId, paymentId);
      audit({
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
      linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "processing");
      return {
        payment: getPayment(paymentId)!,
        approval: getApproval(approvalId),
        replayed: false,
      };
    }

    audit({
      userId: input.userId,
      paymentId,
      actor: "system",
      eventType: "payment.authorized",
      detail: { explanation: decision.explanation, approvalHash: decision.approvalHash },
    });
    linkMerchantRequest(input.merchantRequestId ?? null, paymentId, "processing");
    return { executeId: paymentId };
  });

  if ("executeId" in planned) {
    const payment = await executeAuthorizedPayment(planned.executeId);
    return {
      payment,
      approval: getApprovalForPayment(payment.id),
      replayed: false,
    };
  }

  if (planned.replayed && planned.payment.status === "authorized") {
    const payment = await executeAuthorizedPayment(planned.payment.id);
    return { payment, approval: planned.approval, replayed: true };
  }

  if (!planned.replayed && planned.payment.status === "denied") {
    emitMerchantEvent({
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
    emitMerchantEvent({
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

function claimForExecution(paymentId: string): boolean {
  return withTransaction(() => {
    const row = getPayment(paymentId);
    if (!row || row.status !== "authorized") return false;
    setPaymentStatus(paymentId, "submitted");
    audit({
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
  if (!claimForExecution(paymentId)) {
    return getPayment(paymentId)!;
  }

  const payment = getPayment(paymentId)!;
  const policyVault = payment.policy_id
    ? (getDb()
        .prepare("SELECT vault_id FROM policies WHERE id = ?")
        .get(payment.policy_id) as { vault_id: string | null } | undefined)
    : undefined;
  const vault = policyVault?.vault_id ? vaultById(policyVault.vault_id) : null;
  const agent = payment.agent_id ? getAgent(payment.agent_id) : null;
  const merchant = getMerchant(payment.merchant_id);
  if (!vault || !agent || !merchant) {
    return failPayment(paymentId, "Vault, agent or merchant disappeared before execution.");
  }

  const attemptNo =
    (
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM payment_attempts WHERE payment_id = ?")
        .get(paymentId) as { count: number }
    ).count + 1;
  const attemptId = randomId("att_");
  getDb()
    .prepare(
      `INSERT INTO payment_attempts (id, payment_id, attempt_no, rail, request_payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
    )
    .run(
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

  getDb()
    .prepare("UPDATE payment_attempts SET status = ?, response_payload = ?, tx_hash = ? WHERE id = ?")
    .run(
      result.outcome,
      JSON.stringify(result.raw ?? { error: result.error }),
      result.txHash,
      attemptId,
    );

  if (result.outcome === "failed") {
    return failPayment(paymentId, result.error ?? "settlement failed", result.txHash);
  }

  if (result.outcome === "unknown") {
    withTransaction(() => {
      const row = getPayment(paymentId)!;
      if (row.status === "submitted") setPaymentStatus(paymentId, "confirming");
      setPaymentStatus(paymentId, "unknown", {
        tx_hash: result.txHash,
        chain_status: result.chainStatus,
        error: result.error,
      });
      audit({
        userId: row.user_id,
        paymentId,
        actor: "chain",
        eventType: "payment.unknown",
        detail: { error: result.error, txHash: result.txHash },
      });
    });
    emitMerchantEvent({
      merchantId: payment.merchant_id,
      paymentId,
      eventType: "payment.unknown",
      data: { paymentId, status: "unknown", gross: payment.amount_gross },
    });
    return getPayment(paymentId)!;
  }

  const settled = withTransaction(() => {
    const row = getPayment(paymentId)!;
    if (row.status === "submitted") setPaymentStatus(paymentId, "confirming");
    setPaymentStatus(paymentId, "succeeded", {
      tx_hash: result.txHash,
      chain_status: result.chainStatus,
      settlement_ref: result.settlementRef,
      error: null,
    });
    commitReservation(paymentId);
    getDb()
      .prepare(
        `INSERT INTO settlements (id, payment_id, rail, tx_hash, receipt_id, finality, amount_net,
          payout, asset, network, verified_at, raw, created_at)
         VALUES (?, ?, ?, ?, NULL, 'FINAL', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(payment_id) DO UPDATE SET
           tx_hash = excluded.tx_hash, finality = excluded.finality, amount_net = excluded.amount_net,
           payout = excluded.payout, verified_at = excluded.verified_at, raw = excluded.raw`,
      )
      .run(
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
      );
    feeEntries({
      paymentId,
      userFee: BigInt(row.user_fee),
      merchantFee: BigInt(row.merchant_fee),
      status: result.feeCollected ? "collected" : "owed",
    });
    updateVaultBalance(vault, BigInt(row.amount_gross) + BigInt(row.user_fee));
    linkMerchantRequest(row.merchant_request_id, paymentId, "paid");
    audit({
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
    audit({
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
    return getPayment(paymentId)!;
  });

  if (vault.rail === "testnet") {
    void syncVaultBalance(vault.id);
  }
  emitMerchantEvent({
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

function failPayment(paymentId: string, error: string, txHash: string | null = null): PaymentRow {
  const settled = withTransaction(() => {
    const row = getPayment(paymentId)!;
    if (row.status === "submitted") setPaymentStatus(paymentId, "failed", {
      tx_hash: txHash,
      chain_status: "failed",
      error,
    });
    else if (row.status === "confirming") setPaymentStatus(paymentId, "failed", {
      tx_hash: txHash,
      chain_status: "failed",
      error,
    });
    else if (row.status === "authorized") setPaymentStatus(paymentId, "failed", {
      tx_hash: txHash,
      chain_status: "failed",
      error,
    });
    else if (row.status !== "failed") {
      throw new Error(`cannot fail payment in status ${row.status}`);
    }
    releaseReservation(paymentId);
    linkMerchantRequest(row.merchant_request_id, paymentId, "open");
    audit({
      userId: row.user_id,
      paymentId,
      actor: "chain",
      eventType: "payment.failed",
      detail: { error, txHash },
    });
    return getPayment(paymentId)!;
  });
  emitMerchantEvent({
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
  sweepExpiredApprovals(input.userId);
  const claimed = withTransaction(() => {
    const approval = getApproval(input.approvalId);
    if (!approval) throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    const payment = getPayment(approval.payment_id);
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
    getDb()
      .prepare("UPDATE approvals SET status = 'approving' WHERE id = ?")
      .run(approval.id);
    return { approval, payment };
  });

  const policy = loadPolicyById(claimed.approval.policy_id);
  if (!policy) throw new ApiError(409, "POLICY_NOT_FOUND", "Policy not found.");
  const vault = policy.row.vault_id ? vaultById(policy.row.vault_id) : null;
  if (!vault) throw new ApiError(409, "VAULT_NOT_FOUND", "Vault not found.");
  const agent = claimed.payment.agent_id ? getAgent(claimed.payment.agent_id) : null;
  const merchant = getMerchant(claimed.payment.merchant_id);
  if (!agent || !merchant) {
    withTransaction(() => {
      getDb().prepare("UPDATE approvals SET status = 'pending' WHERE id = ?").run(claimed.approval.id);
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
    withTransaction(() => {
      getDb().prepare("UPDATE approvals SET status = 'pending' WHERE id = ?").run(claimed.approval.id);
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
  const usage = usageForPolicy({
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
    return withTransaction(() => {
      setPaymentStatus(claimed.payment.id, "denied", {
        decision: "DENY",
        deny_code: decision.decision === "DENY" ? decision.code : "APPROVAL_EXPIRED",
        deny_message:
          decision.decision === "DENY"
            ? decision.message
            : "The policy changed after approval. Request a new approval.",
      });
      releaseReservation(claimed.payment.id);
      getDb()
        .prepare("UPDATE approvals SET status = 'approved', decided_at = ?, tx_hash = ? WHERE id = ?")
        .run(now(), txHash, claimed.approval.id);
      audit({
        userId: input.userId,
        paymentId: claimed.payment.id,
        actor: "user",
        eventType: "payment.denied_after_approval",
        detail: { decision: decision.decision },
      });
      return { payment: getPayment(claimed.payment.id)!, approval: getApproval(claimed.approval.id)! };
    });
  }

  withTransaction(() => {
    setPaymentStatus(claimed.payment.id, "authorized", {
      decision: "ALLOW",
      deny_code: null,
      deny_message: null,
    });
    getDb()
      .prepare("UPDATE approvals SET status = 'approved', decided_at = ?, tx_hash = ? WHERE id = ?")
      .run(now(), txHash, claimed.approval.id);
    audit({
      userId: input.userId,
      paymentId: claimed.payment.id,
      actor: "user",
      eventType: "approval.approved",
      detail: { txHash, approvalHash: claimed.approval.approval_hash },
    });
  });

  const payment = await executeAuthorizedPayment(claimed.payment.id);
  return { payment, approval: getApproval(claimed.approval.id)! };
}

export function denyPayment(input: { approvalId: string; userId: string }): {
  payment: PaymentRow;
  approval: ApprovalRow;
} {
  return withTransaction(() => {
    const approval = getApproval(input.approvalId);
    if (!approval) throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    const payment = getPayment(approval.payment_id);
    if (!payment || payment.user_id !== input.userId) {
      throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    }
    if (approval.status !== "pending") {
      throw new ApiError(409, "APPROVAL_NOT_PENDING", "This approval is no longer pending.");
    }
    if (payment.status !== "awaiting_approval") {
      throw new ApiError(409, "PAYMENT_NOT_AWAITING", "This payment is not awaiting approval.");
    }
    getDb()
      .prepare("UPDATE approvals SET status = 'denied', decided_at = ? WHERE id = ?")
      .run(now(), approval.id);
    setPaymentStatus(payment.id, "denied", {
      decision: "DENY",
      deny_code: "APPROVAL_DENIED",
      deny_message: "You denied this payment.",
    });
    releaseReservation(payment.id);
    linkMerchantRequest(payment.merchant_request_id, payment.id, "open");
    audit({
      userId: input.userId,
      paymentId: payment.id,
      actor: "user",
      eventType: "approval.denied",
      detail: {},
    });
    const result = {
      payment: getPayment(payment.id)!,
      approval: getApproval(approval.id)!,
    };
    emitMerchantEvent({
      merchantId: payment.merchant_id,
      paymentId: payment.id,
      eventType: "payment.denied",
      data: { paymentId: payment.id, status: "denied", reason: "approval_denied" },
    });
    return result;
  });
}

export async function reconcilePayment(paymentId: string): Promise<PaymentRow> {
  const payment = getPayment(paymentId);
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.status !== "unknown" && payment.status !== "submitted" && payment.status !== "confirming") {
    return payment;
  }
  const vault = payment.policy_id
    ? (() => {
        const policy = loadPolicyById(payment.policy_id!);
        return policy?.row.vault_id ? vaultById(policy.row.vault_id) : null;
      })()
    : null;
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
  const merchant = getMerchant(payment.merchant_id);
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
    audit({
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

  return withTransaction(() => {
    const row = getPayment(paymentId)!;
    if (row.status === "submitted") setPaymentStatus(paymentId, "confirming");
    setPaymentStatus(paymentId, "succeeded", {
      tx_hash: payment.tx_hash,
      chain_status: settlement.feeCollected ? "succeeded" : "merchant_paid_fee_pending",
      settlement_ref: payment.tx_hash ?? `vault:${payment.id}`,
      error: null,
    });
    commitReservation(paymentId);
    feeEntries({
      paymentId,
      userFee: BigInt(row.user_fee),
      merchantFee: BigInt(row.merchant_fee),
      status: settlement.feeCollected ? "collected" : "owed",
    });
    updateVaultBalance(vault, BigInt(row.amount_gross) + BigInt(row.user_fee));
    audit({
      userId: row.user_id,
      paymentId,
      actor: "system",
      eventType: "payment.reconciled",
      detail: { vaultStatus: vaultPayment.status, logVerified },
    });
    return getPayment(paymentId)!;
  });
}

export function pendingApprovals(userId: string): Array<
  ApprovalRow & { payment: PaymentRow; merchantName: string; agentName: string }
> {
  sweepExpiredApprovals(userId);
  const rows = getDb()
    .prepare(
      `SELECT a.*, pr.merchant_id AS p_merchant_id, pr.agent_id AS p_agent_id,
              m.name AS merchant_name, ag.name AS agent_name
       FROM approvals a
       JOIN payment_requests pr ON pr.id = a.payment_id
       JOIN merchants m ON m.id = pr.merchant_id
       LEFT JOIN agents ag ON ag.id = pr.agent_id
       WHERE pr.user_id = ? AND a.status = 'pending'
       ORDER BY a.created_at DESC`,
    )
    .all(userId) as unknown as Array<
    ApprovalRow & { merchant_name: string; agent_name: string | null }
  >;
  return rows.map((row) => {
    const payment = getPayment(row.payment_id)!;
    return {
      ...row,
      payment,
      merchantName: row.merchant_name,
      agentName: row.agent_name ?? "Unknown agent",
    };
  });
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

export function merchantPayments(merchantId: string, limit = 50): PaymentRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM payment_requests WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(merchantId, limit) as unknown as PaymentRow[];
}

export function merchantSummary(merchantId: string): {
  gross: bigint;
  merchantFee: bigint;
  net: bigint;
  count: number;
} {
  const rows = getDb()
    .prepare(
      "SELECT amount_gross, merchant_fee, amount_net FROM payment_requests WHERE merchant_id = ? AND status = 'succeeded'",
    )
    .all(merchantId) as unknown as Array<{
    amount_gross: string;
    merchant_fee: string;
    amount_net: string;
  }>;
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

export function budgetForAgent(agentId: string): {
  policyId: string;
  totalBudget: bigint;
  remaining: bigint;
  committed: bigint;
  held: bigint;
  balance: bigint;
  available: bigint;
} | null {
  const agent = getAgent(agentId);
  if (!agent?.vault_id) return null;
  const policy = loadPolicyForVault(agent.vault_id);
  if (!policy) return null;
  const summary = budgetSummary({
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

