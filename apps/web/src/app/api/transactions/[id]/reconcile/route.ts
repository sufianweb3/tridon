import { ApiError, ok, withApi } from "@/lib/api";
import { getPayment, reconcilePayment } from "@/lib/payments";
import { requireCsrfApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const { id } = await params;
    const existing = getPayment(id);
    if (!existing || existing.user_id !== user.id) {
      throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    }
    const payment = await reconcilePayment(id);
    return ok({ payment: paymentView(payment) });
  });
}
