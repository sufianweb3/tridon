import { closeDb, getDb } from "../apps/web/src/lib/db";

const db = getDb();
console.log("policies");
console.table(db.prepare("SELECT id, status, version, daily_limit, updated_at FROM policies").all());
console.log("recent audits");
console.table(
  db
    .prepare("SELECT event_type, detail, created_at FROM audit_events ORDER BY created_at DESC LIMIT 10")
    .all(),
);
closeDb();
