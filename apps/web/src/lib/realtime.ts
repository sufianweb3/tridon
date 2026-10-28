import { createRealtime, rawSql } from "@neon/realtime/server";

/**
 * Neon Realtime: the SQL and its user parameter are sealed on the server, so
 * the browser can subscribe but cannot read or change either. Only the URL is
 * ever sent to the client; NEON_REALTIME_SECRET stays server-side.
 */
export interface LivePaymentRow {
  id: string;
  status: string;
  amount_gross: string;
  created_at: string;
  updated_at: string;
  merchant_name: string;
  agent_name: string | null;
}

function databaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "neondb";
  try {
    return new URL(url).pathname.replace(/^\//, "") || "neondb";
  } catch {
    return "neondb";
  }
}

let instance: ReturnType<typeof createRealtime> | null = null;

export function getRealtime(): ReturnType<typeof createRealtime> | null {
  const secret = process.env.NEON_REALTIME_SECRET;
  if (!secret) return null;
  if (!instance) {
    instance = createRealtime({ secret, db: databaseName() });
  }
  return instance;
}

export function realtimeConfigured(): boolean {
  return Boolean(process.env.NEON_REALTIME_URL && process.env.NEON_REALTIME_SECRET);
}

/**
 * The user id is a bound parameter, not string interpolation. The query stays
 * read-only and deterministic: no now(), no random(), no writes.
 */
export function paymentsLiveQuery(userId: string) {
  return rawSql<LivePaymentRow>(
    `SELECT pr.id, pr.status, pr.amount_gross, pr.created_at, pr.updated_at,
            m.name AS merchant_name, ag.name AS agent_name
     FROM payment_requests pr
     JOIN merchants m ON m.id = pr.merchant_id
     LEFT JOIN agents ag ON ag.id = pr.agent_id
     WHERE pr.user_id = $1
     ORDER BY pr.created_at DESC
     LIMIT 20`,
    [userId],
  );
}
