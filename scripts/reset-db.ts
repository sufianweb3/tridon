/**
 * Delete every row in the AgentSpend Postgres schema so `pnpm seed` can
 * provision a fresh demo workspace. Destructive and opt-in: requires `--yes`.
 *
 * The master key (AGENTSPEND_MASTER_KEY) is intentionally left in place.
 * Removing it would make any remaining encrypted signer material unreadable,
 * and it is not part of the database.
 */
import { closeDb, ensureSchema, execute } from "../apps/web/src/lib/db";

const confirmed = process.argv.includes("--yes");
if (!confirmed) {
  console.error("Refusing to delete the AgentSpend database without confirmation.");
  console.error("");
  console.error(`  database: ${process.env.DATABASE_URL ? "DATABASE_URL (set)" : "DATABASE_URL (missing)"}`);
  console.error("");
  console.error("This removes all users, payments, approvals and settings.");
  console.error("Re-run with:  pnpm db:reset -- --yes");
  process.exit(1);
}

const TABLES = [
  "webhook_deliveries",
  "webhook_endpoints",
  "merchant_requests",
  "approvals",
  "fee_ledger_entries",
  "settlements",
  "payment_attempts",
  "budget_reservations",
  "audit_events",
  "payment_requests",
  "policy_merchant_rules",
  "policies",
  "merchant_api_credentials",
  "merchant_services",
  "merchant_sessions",
  "agent_credentials",
  "agents",
  "vaults",
  "auth_nonces",
  "sessions",
  "wallet_connections",
  "users",
  "merchants",
  "app_settings",
];

async function main(): Promise<void> {
  await ensureSchema();
  await execute(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Truncated ${TABLES.length} tables in the AgentSpend database.`);
  console.log("Run `pnpm seed` to provision a new demo workspace.");
}

main()
  .catch((error) => {
    console.error("Reset failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
