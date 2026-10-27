import { ok, pagination, queryParam, withApi } from "@/lib/api";
import { listPayments, paymentCount } from "@/lib/payments";
import { requireUserApi } from "@/lib/server-auth";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const { limit, offset } = pagination(request.url);
    const rows = listPayments({
      userId: user.id,
      limit,
      offset,
      status: queryParam(request, "status"),
      merchantId: queryParam(request, "merchantId"),
      agentId: queryParam(request, "agentId"),
    });
    return ok({
      payments: rows.map(paymentView),
      total: paymentCount(user.id),
      limit,
      offset,
    });
  });
}
