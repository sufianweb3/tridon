import { closeDb, getDb, now } from "../apps/web/src/lib/db";

const db = getDb();
const result = db
  .prepare("UPDATE agents SET description = ? WHERE id = ?")
  .run("Handles small operational purchases and infrastructure renewals.", "agent-ops");
console.log("updated", result.changes, "at", now());
closeDb();
