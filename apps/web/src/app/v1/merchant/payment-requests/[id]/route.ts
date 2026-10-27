import { ApiError, ok, withApi } from "@/lib/api";
import { merchantFromBearer } from "@/lib/auth";
import { getMerchantRequest, merchantRequestView } from "@/lib/merchant";
import { getPayment } from "@/lib/payments";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const merchant = merchantFromBearer(request);
    const { id } = await params;
    const row = getMerchantRequest(merchant.merchantId, id);
    if (!row) throw new ApiError(404, "REQUEST_NOT_FOUND", "Payment request not found.");
    const payment = row.payment_id ? getPayment(row.payment_id) : null;
    return ok({
      request: merchantRequestView(row),
      payment: payment ? paymentView(payment) : null,
    });
  });
}
