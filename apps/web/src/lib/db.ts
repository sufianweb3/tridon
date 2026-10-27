import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dataDir, dbPath } from "./paths";

/**
 * All token amounts are stored as decimal TEXT and parsed into bigint. SQLite
 * INTEGER is only used for timestamps, counts and booleans. No floating point
 * touches a monetary value anywhere in the stack.
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wallet TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  provider TEXT NOT NULL,
  network TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  csrf TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
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
  created_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_sessions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_api_credentials (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
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
  valid_from INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL,
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
  request_expiry INTEGER NOT NULL,
  rail TEXT NOT NULL,
  tx_hash TEXT,
  chain_status TEXT,
  settlement_ref TEXT,
  error TEXT,
  simulate_failure INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
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
  created_at INTEGER NOT NULL,
  released_at INTEGER
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
  created_at INTEGER NOT NULL
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
  verified_at INTEGER,
  raw TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_ledger_entries (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(payment_id, kind)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  approval_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  payment_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_payment ON audit_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
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
  request_expiry INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  UNIQUE(merchant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: DatabaseSync | undefined;
let txDepth = 0;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

/**
 * BEGIN IMMEDIATE takes the write lock before any read, so two concurrent
 * payment attempts cannot both read the same remaining budget and both commit.
 * This is the SQLite equivalent of the Postgres advisory lock in the ADR.
 */
export function withTransaction<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  txDepth += 1;
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; the original error is more useful
    }
    throw error;
  } finally {
    txDepth -= 1;
  }
}

export function now(): number {
  return Date.now();
}

export function setting(key: string, fallback: string): string {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export type Row = Record<string, unknown>;
