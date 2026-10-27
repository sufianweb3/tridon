import { getDb, now } from "./db";
import { randomId, redact } from "./crypto";

export type AuditActor = "user" | "agent" | "merchant" | "system" | "chain";

export function audit(input: {
  userId?: string | null;
  paymentId?: string | null;
  actor: AuditActor;
  eventType: string;
  detail?: Record<string, unknown>;
}): void {
  getDb()
    .prepare(
      `INSERT INTO audit_events (id, user_id, payment_id, actor, event_type, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomId("aud_"),
      input.userId ?? null,
      input.paymentId ?? null,
      input.actor,
      input.eventType,
      JSON.stringify(redact(input.detail ?? {})),
      now(),
    );
}

export interface AuditRow {
  id: string;
  user_id: string | null;
  payment_id: string | null;
  actor: string;
  event_type: string;
  detail: string;
  created_at: number;
}

export function listAudit(limit = 50, userId?: string): AuditRow[] {
  const db = getDb();
  const rows = userId
    ? db
        .prepare(
          "SELECT * FROM audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(userId, limit)
    : db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?").all(limit);
  return rows as unknown as AuditRow[];
}
