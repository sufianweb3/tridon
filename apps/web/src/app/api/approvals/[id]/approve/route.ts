import { ApiError, ok, requestIp, withApi } from "@/lib/api";
import { approvePayment } from "@/lib/payments";
import { appConfig } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireCsrfApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const limit = checkRateLimit(
      `approval:${user.id}:${requestIp(request)}`,
      appConfig.limits.approvalRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many approval attempts. Try again shortly.");
    }
    const { id } = await params;
    const result = await approvePayment({ approvalId: id, userId: user.id });
    return ok({
      payment: paymentView(result.payment),
      approval: {
        id: result.approval.id,
        status: result.approval.status,
        txHash: result.approval.tx_hash,
      },
    });
  });
}
