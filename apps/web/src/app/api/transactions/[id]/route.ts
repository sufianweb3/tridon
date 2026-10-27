import { ApiError, ok, withApi } from "@/lib/api";
import { paymentDetail } from "@/lib/payments";
import { requireUserApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

function parseDetail(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const { id } = await params;
    const detail = paymentDetail(id, user.id);
    if (!detail) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    return ok({
      payment: paymentView(detail.payment),
      merchant: detail.merchant
        ? {
            id: detail.merchant.id,
            name: detail.merchant.name,
            payoutAccount: detail.merchant.payout_account,
            category: detail.merchant.category,
          }
        : null,
      agent: detail.agent ? { id: detail.agent.id, name: detail.agent.name } : null,
      policyName: detail.policyName,
      approval: detail.approval
        ? {
            id: detail.approval.id,
            status: detail.approval.status,
            approvalHash: detail.approval.approval_hash,
            expiresAt: detail.approval.expires_at,
            decidedAt: detail.approval.decided_at,
            txHash: detail.approval.tx_hash,
          }
        : null,
      fees: detail.fees,
      settlement: detail.settlement,
      timeline: detail.timeline.map((event) => ({
        id: event.id,
        actor: event.actor,
        eventType: event.event_type,
        detail: parseDetail(event.detail),
        createdAt: event.created_at,
      })),
      attempts: detail.attempts,
    });
  });
}
