import { ok, withApi } from "@/lib/api";
import { denyPayment } from "@/lib/payments";
import { requireCsrfApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const { id } = await params;
    const result = await denyPayment({ approvalId: id, userId: user.id });
    return ok({
      payment: await paymentView(result.payment),
      approval: { id: result.approval.id, status: result.approval.status },
    });
  });
}
