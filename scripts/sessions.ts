import { closeDb, getDb } from "../apps/web/src/lib/db";

const db = getDb();
const rows = db
  .prepare(
    "SELECT id, user_id, wallet, csrf, auth_method, created_at, expires_at FROM sessions ORDER BY created_at DESC LIMIT 5",
  )
  .all();
console.log(rows);
closeDb();
