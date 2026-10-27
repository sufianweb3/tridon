import { getDb } from "../apps/web/src/lib/db";

const ids = ["pay_J6gLHjRyUDUZjKfY", "pay_PvAVMbyhODYNslnQ"];
const db = getDb();

const placeholders = ids.map(() => "?").join(",");

console.log("payments");
console.table(
  db
    .prepare(
      `SELECT id, status, deny_code, tx_hash, chain_status, error,
              amount_gross, settlement_ref, created_at, updated_at
       FROM payment_requests WHERE id IN (${placeholders})`,
    )
    .all(...ids),
);

console.log("attempts");
console.table(
  db
    .prepare(`SELECT * FROM payment_attempts WHERE payment_id IN (${placeholders})`)
    .all(...ids),
);

console.log("events");
console.table(
  db
    .prepare(
      `SELECT event_type, detail, created_at FROM audit_events
       WHERE payment_id IN (${placeholders}) ORDER BY created_at`,
    )
    .all(...ids),
);

console.log("approvals");
console.table(
  db
    .prepare(`SELECT * FROM approvals WHERE payment_id IN (${placeholders})`)
    .all(...ids),
);
