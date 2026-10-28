import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";

/**
 * Postgres is the only data store. All token amounts are stored as decimal TEXT
 * and parsed into bigint. BIGINT is used for millisecond timestamps and counts,
 * INTEGER for booleans and small counters. No floating point touches a monetary
 * value anywhere in the stack.
 *
 * `pg` returns int8 (BIGINT) as a string by default. Every int8 column in this
 * schema is a millisecond timestamp or a count, both safely below 2^53, so the
 * parser below keeps the rest of the application working with numbers.
 */
types.setTypeParser(20, (value) => Number(value));

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet TEXT UNIQUE,
  email TEXT,
  neon_user_id TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  provider TEXT NOT NULL,
  network TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  csrf TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  rail TEXT NOT NULL,
  account_id TEXT NOT NULL,
  token_account TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  token_decimals INTEGER NOT NULL,
  fee_account TEXT NOT NULL,
  balance TEXT NOT NULL DEFAULT '0',
  chain_status TEXT NOT NULL DEFAULT 'ready',
  deploy_tx TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_id TEXT REFERENCES vaults(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  public_key TEXT,
  key_ciphertext TEXT,
  key_iv TEXT,
  key_tag TEXT,
  allowance_yocto TEXT,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  payout_account TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  accent TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_sessions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_services (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_api_credentials (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id),
  vault_id TEXT REFERENCES vaults(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  total_budget TEXT NOT NULL,
  per_tx_limit TEXT NOT NULL,
  daily_limit TEXT NOT NULL,
  weekly_limit TEXT NOT NULL,
  monthly_limit TEXT NOT NULL,
  unknown_merchant_mode TEXT NOT NULL,
  unknown_merchant_cap TEXT NOT NULL DEFAULT '0',
  approval_mode TEXT NOT NULL,
  valid_from BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_merchant_rules (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  payout_account TEXT NOT NULL,
  per_tx_limit TEXT NOT NULL DEFAULT '0',
  window_limit TEXT NOT NULL DEFAULT '0',
  window_secs INTEGER NOT NULL DEFAULT 0,
  allowlisted INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  UNIQUE(policy_id, merchant_id)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_id TEXT REFERENCES agents(id),
  policy_id TEXT REFERENCES policies(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  service_id TEXT REFERENCES merchant_services(id),
  merchant_request_id TEXT,
  amount_gross TEXT NOT NULL,
  user_fee TEXT NOT NULL,
  merchant_fee TEXT NOT NULL,
  amount_net TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  deny_code TEXT,
  deny_message TEXT,
  approval_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_expiry BIGINT NOT NULL,
  rail TEXT NOT NULL,
  tx_hash TEXT,
  chain_status TEXT,
  settlement_ref TEXT,
  error TEXT,
  simulate_failure INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(agent_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payments_user_time ON payment_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payment_requests(merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  amount_gross TEXT NOT NULL,
  amount_debit TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  released_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_reservations_policy ON budget_reservations(policy_id, status);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  rail TEXT NOT NULL,
  request_payload TEXT,
  response_payload TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  rail TEXT NOT NULL,
  tx_hash TEXT,
  receipt_id TEXT,
  finality TEXT NOT NULL,
  amount_net TEXT NOT NULL,
  payout TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  verified_at BIGINT,
  raw TEXT,
  receipt_key TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_ledger_entries (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(payment_id, kind)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  approval_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at BIGINT NOT NULL,
  decided_at BIGINT,
  tx_hash TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  payment_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_payment ON audit_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  delivered_at BIGINT,
  UNIQUE(endpoint_id, event_id)
);

CREATE TABLE IF NOT EXISTS merchant_requests (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  service_id TEXT NOT NULL REFERENCES merchant_services(id),
  amount TEXT NOT NULL,
  asset TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_expiry BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  paid_at BIGINT,
  UNIQUE(merchant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Db = Pool | PoolClient;

const globalForDb = globalThis as unknown as { agentspendPool?: Pool };
const transactionStore = new AsyncLocalStorage<PoolClient>();

export function getPool(): Pool {
  if (globalForDb.agentspendPool) return globalForDb.agentspendPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to .env.local (run `neon env pull`) before starting AgentSpend.",
    );
  }
  const created = new Pool({
    connectionString,
    max: Number(process.env.AGENTSPEND_DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  created.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });
  globalForDb.agentspendPool = created;
  return created;
}

function active(): Db {
  return transactionStore.getStore() ?? getPool();
}

/**
 * SQLite used `?` placeholders throughout this codebase. Keeping that syntax at
 * the call sites makes the migration mechanical and auditable; this function is
 * the only place that rewrites it to Postgres `$n` parameters.
 */
export function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

let schemaPromise: Promise<void> | undefined;

async function migrate(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('agentspend:schema'))");
    await client.query(SCHEMA_SQL);
    // Additive migrations for databases created before a column was introduced.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS neon_user_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS users_neon_user_id_unique ON users (neon_user_id) WHERE neon_user_id IS NOT NULL;
      ALTER TABLE settlements ADD COLUMN IF NOT EXISTS receipt_key TEXT;
    `);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('agentspend:schema'))");
    } catch {
      // the connection closing releases the advisory lock anyway
    }
    client.release();
  }
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = migrate().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const result = await active().query(toPg(sql), params);
  return result.rows as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  await ensureSchema();
  const result = await active().query(toPg(sql), params);
  return result.rowCount ?? 0;
}

/**
 * Runs `fn` on one connection inside BEGIN/COMMIT. Nested calls join the
 * existing transaction, so helpers never accidentally write outside it.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionStore.getStore()) return fn();
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await transactionStore.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure; the original error is more useful
    }
    throw error;
  } finally {
    client.release();
  }
}

export function closeDb(): void {
  const current = globalForDb.agentspendPool;
  globalForDb.agentspendPool = undefined;
  if (current) void current.end();
}

export function now(): number {
  return Date.now();
}

export async function setting(key: string, fallback: string): Promise<string> {
  const row = await queryOne<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = ?",
    [key],
  );
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export type Row = Record<string, unknown>;
