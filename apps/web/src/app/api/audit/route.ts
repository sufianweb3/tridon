import { ok, withApi } from "@/lib/api";
import { listAudit } from "@/lib/audit";
import { requireUserApi } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const rows = listAudit(100, user.id);
    return ok({
      events: rows.map((row) => {
        let detail: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(row.detail) as unknown;
          if (parsed && typeof parsed === "object") detail = parsed as Record<string, unknown>;
        } catch {
          detail = {};
        }
        return {
          id: row.id,
          paymentId: row.payment_id,
          actor: row.actor,
          eventType: row.event_type,
          detail,
          createdAt: row.created_at,
        };
      }),
    });
  });
}
