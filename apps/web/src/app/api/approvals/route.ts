import { ok, withApi } from "@/lib/api";
import { pendingApprovals } from "@/lib/payments";
import { requireUserApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const pending = await pendingApprovals(user.id);
    const approvals = await Promise.all(
      pending.map(async (approval) => ({
        id: approval.id,
        paymentId: approval.payment_id,
        status: approval.status,
        approvalHash: approval.approval_hash,
        expiresAt: approval.expires_at,
        createdAt: approval.created_at,
        merchantName: approval.merchantName,
        agentName: approval.agentName,
        payment: await paymentView(approval.payment),
      })),
    );
    return ok({ approvals });
  });
}
