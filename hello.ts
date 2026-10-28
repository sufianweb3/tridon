import { timingSafeEqual } from "node:crypto";
import { attachDatabasePool } from "@neon/functions";
import { Pool } from "pg";

/**
 * AgentSpend status function (Neon Functions).
 *
 * This is a server-to-server endpoint, not a public API: it requires the
 * shared AGENTSPEND_FUNCTION_SECRET and reads only the requested agent or
 * payment. It queries Postgres directly so the app server and the function
 * both read the same authoritative rows.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

const SECRET = process.env.AGENTSPEND_FUNCTION_SECRET ?? "";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json" },
  });
}

function authorized(request: Request): boolean {
  if (!SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(SECRET);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

interface AgentRow {
  id: string;
  name: string;
  status: string;
  vault_id: string | null;
  rail: string | null;
  account_id: string | null;
  balance: string | null;
  policy_id: string | null;
  policy_name: string | null;
  version: number | null;
  total_budget: string | null;
  per_tx_limit: string | null;
  daily_limit: string | null;
  weekly_limit: string | null;
  monthly_limit: string | null;
}

interface PaymentRow {
  id: string;
  status: string;
  amount_gross: string;
  amount_net: string;
  asset: string;
  network: string;
  rail: string;
  tx_hash: string | null;
  settlement_ref: string | null;
  error: string | null;
  created_at: string;
  merchant_name: string;
  payout_account: string;
}

async function agentStatus(agentId: string): Promise<Response> {
  const agent = await pool.query<AgentRow>(
    `SELECT a.id, a.name, a.status, a.vault_id,
            v.rail, v.account_id, v.balance,
            p.id AS policy_id, p.name AS policy_name, p.version,
            p.total_budget, p.per_tx_limit, p.daily_limit, p.weekly_limit, p.monthly_limit
     FROM agents a
     LEFT JOIN vaults v ON v.id = a.vault_id
     LEFT JOIN policies p ON p.vault_id = v.id
     WHERE a.id = $1`,
    [agentId],
  );
  const row = agent.rows[0];
  if (!row) return json({ ok: false, error: "AGENT_NOT_FOUND" }, 404);

  const totals = await pool.query<{
    status: string;
    count: number;
    gross: string;
  }>(
    `SELECT status, COUNT(*)::int AS count,
            COALESCE(SUM(amount_gross::numeric), 0)::text AS gross
     FROM payment_requests WHERE agent_id = $1 GROUP BY status`,
    [agentId],
  );
  const recent = await pool.query<{
    id: string;
    status: string;
    amount_gross: string;
    created_at: string;
    merchant_name: string;
  }>(
    `SELECT pr.id, pr.status, pr.amount_gross, pr.created_at, m.name AS merchant_name
     FROM payment_requests pr JOIN merchants m ON m.id = pr.merchant_id
     WHERE pr.agent_id = $1 ORDER BY pr.created_at DESC LIMIT 5`,
    [agentId],
  );

  return json({
    ok: true,
    function: "agentspend-status",
    checkedAt: new Date().toISOString(),
    agent: {
      id: row.id,
      name: row.name,
      status: row.status,
      vaultId: row.vault_id,
      rail: row.rail,
      vaultAccount: row.account_id,
      balance: row.balance,
    },
    policy: row.policy_id
      ? {
          id: row.policy_id,
          name: row.policy_name,
          version: row.version,
          totalBudget: row.total_budget,
          perTxLimit: row.per_tx_limit,
          dailyLimit: row.daily_limit,
          weeklyLimit: row.weekly_limit,
          monthlyLimit: row.monthly_limit,
        }
      : null,
    payments: Object.fromEntries(
      totals.rows.map((entry) => [
        entry.status,
        { count: entry.count, gross: entry.gross },
      ]),
    ),
    recent: recent.rows,
    note: "TESTUSD is a demo token on NEAR testnet. It is not Circle USDC.",
  });
}

async function paymentStatus(paymentId: string): Promise<Response> {
  const result = await pool.query<PaymentRow>(
    `SELECT pr.id, pr.status, pr.amount_gross, pr.amount_net, pr.asset, pr.network,
            pr.rail, pr.tx_hash, pr.settlement_ref, pr.error, pr.created_at,
            m.name AS merchant_name, m.payout_account
     FROM payment_requests pr JOIN merchants m ON m.id = pr.merchant_id
     WHERE pr.id = $1`,
    [paymentId],
  );
  const row = result.rows[0];
  if (!row) return json({ ok: false, error: "PAYMENT_NOT_FOUND" }, 404);
  return json({
    ok: true,
    function: "agentspend-status",
    checkedAt: new Date().toISOString(),
    payment: row,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (!authorized(request)) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    const paymentId = url.searchParams.get("paymentId");
    if (agentId) return agentStatus(agentId);
    if (paymentId) return paymentStatus(paymentId);
    return json({
      ok: true,
      function: "agentspend-status",
      usage: "?agentId=<id> or ?paymentId=<id>",
    });
  },
};
