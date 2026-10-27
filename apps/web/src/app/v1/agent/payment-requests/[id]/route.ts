import { ApiError, ok, withApi } from "@/lib/api";
import { agentFromBearer } from "@/lib/auth";
import { getApprovalForPayment, getPayment } from "@/lib/payments";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const agent = agentFromBearer(request);
    const { id } = await params;
    const payment = getPayment(id);
    if (!payment || payment.user_id !== agent.userId || payment.agent_id !== agent.agentId) {
      throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    }
    const approval = getApprovalForPayment(payment.id);
    return ok({
      payment: paymentView(payment),
      approval: approval
        ? {
            id: approval.id,
            status: approval.status,
            approvalHash: approval.approval_hash,
            expiresAt: approval.expires_at,
          }
        : null,
      fulfillment_allowed: payment.status === "succeeded",
      note:
        payment.status === "unknown"
          ? "Settlement is unverified. Do not fulfill the service."
          : undefined,
    });
  });
}
