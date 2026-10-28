import type { Usage } from "@agentspend/core";
import { DAY_MS } from "@agentspend/core";
import { query, queryOne } from "./db";

/**
 * Usage is derived from budget reservations, not from a mutable counter. A
 * reservation is created in the same Postgres transaction as the payment, so
 * the sum is the single source of truth for committed and in-flight spend.
 *
 * Statuses:
 *  - held: authorized/in-flight/awaiting approval, counts against every cap
 *  - committed: payment succeeded, counts against every cap
 *  - released: denied/failed/cancelled, never counts
 */

export interface ReservationTotals {
  totalGross: bigint;
  heldGross: bigint;
  committedGross: bigint;
  dayGross: bigint;
  weekGross: bigint;
  monthGross: bigint;
  merchantWindowGross: bigint;
  heldDebit: bigint;
}

interface ReservationRow {
  amount_gross: string;
  amount_debit: string;
  created_at: number;
  merchant_id: string;
  status: string;
}

async function rowsForPolicy(policyId: string, excludePaymentId?: string): Promise<ReservationRow[]> {
  const params: unknown[] = [policyId];
  let exclusion = "";
  if (excludePaymentId) {
    exclusion = " AND br.payment_id != ?";
    params.push(excludePaymentId);
  }
  return query<ReservationRow>(
    `SELECT br.amount_gross, br.amount_debit, br.created_at, br.status,
            pr.merchant_id
     FROM budget_reservations br
     JOIN payment_requests pr ON pr.id = br.payment_id
     WHERE br.policy_id = ?
       AND br.status IN ('held', 'committed')${exclusion}`,
    params,
  );
}

export async function reservationTotals(input: {
  policyId: string;
  now: number;
  merchantId?: string;
  windowSecs?: number;
  excludePaymentId?: string;
}): Promise<ReservationTotals> {
  const rows = await rowsForPolicy(input.policyId, input.excludePaymentId);
  const today = Math.floor(input.now / DAY_MS);
  const weekStart = (today - 6) * DAY_MS;
  const monthStart = (today - 29) * DAY_MS;
  const windowStart =
    input.windowSecs && input.windowSecs > 0
      ? input.now - input.windowSecs * 1000
      : Number.NEGATIVE_INFINITY;

  let totalGross = 0n;
  let heldGross = 0n;
  let committedGross = 0n;
  let dayGross = 0n;
  let weekGross = 0n;
  let monthGross = 0n;
  let merchantWindowGross = 0n;
  let heldDebit = 0n;

  for (const row of rows) {
    const gross = BigInt(row.amount_gross);
    totalGross += gross;
    if (row.status === "held") heldGross += gross;
    else committedGross += gross;
    if (row.created_at >= today * DAY_MS) dayGross += gross;
    if (row.created_at >= weekStart) weekGross += gross;
    if (row.created_at >= monthStart) monthGross += gross;
    if (input.merchantId && row.merchant_id === input.merchantId && row.created_at >= windowStart) {
      merchantWindowGross += gross;
    }
    if (row.status === "held") heldDebit += BigInt(row.amount_debit);
  }

  return {
    totalGross,
    heldGross,
    committedGross,
    dayGross,
    weekGross,
    monthGross,
    merchantWindowGross,
    heldDebit,
  };
}

export async function vaultBalanceForPolicy(policyId: string): Promise<bigint> {
  const row = await queryOne<{ balance: string }>(
    `SELECT v.balance FROM policies p JOIN vaults v ON v.id = p.vault_id WHERE p.id = ?`,
    [policyId],
  );
  return BigInt(row?.balance ?? "0");
}

export async function usageForPolicy(input: {
  policyId: string;
  now: number;
  merchantId: string;
  windowSecs: number;
  excludePaymentId?: string;
}): Promise<Usage> {
  const totals = await reservationTotals(input);
  const balance = await vaultBalanceForPolicy(input.policyId);
  return {
    totalGrossCommitted: totals.totalGross,
    dayGross: totals.dayGross,
    weekGross: totals.weekGross,
    monthGross: totals.monthGross,
    merchantWindowGross: totals.merchantWindowGross,
    availableDebit: balance > totals.heldDebit ? balance - totals.heldDebit : 0n,
  };
}

/** Remaining budget is the total cap minus committed + held gross. */
export async function remainingBudget(policyId: string, totalBudget: bigint): Promise<bigint> {
  const totals = await reservationTotals({ policyId, now: Date.now() });
  return totals.totalGross >= totalBudget ? 0n : totalBudget - totals.totalGross;
}

export interface BudgetSummary {
  totalBudget: bigint;
  committedGross: bigint;
  heldGross: bigint;
  remaining: bigint;
  dayGross: bigint;
  weekGross: bigint;
  monthGross: bigint;
  balance: bigint;
  heldDebit: bigint;
  availableBalance: bigint;
}

export async function budgetSummary(input: {
  policyId: string;
  totalBudget: bigint;
  now: number;
}): Promise<BudgetSummary> {
  const totals = await reservationTotals({ policyId: input.policyId, now: input.now });
  const balance = await vaultBalanceForPolicy(input.policyId);
  const committed = totals.totalGross;
  return {
    totalBudget: input.totalBudget,
    committedGross: totals.committedGross,
    heldGross: totals.heldGross,
    remaining: committed >= input.totalBudget ? 0n : input.totalBudget - committed,
    dayGross: totals.dayGross,
    weekGross: totals.weekGross,
    monthGross: totals.monthGross,
    balance,
    heldDebit: totals.heldDebit,
    availableBalance: balance > totals.heldDebit ? balance - totals.heldDebit : 0n,
  };
}
