import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { createMerchantRequest, merchantRequestView } from "@/lib/merchant";
import { requireMerchantCsrfApi } from "@/lib/server-auth";

const schema = z.object({
  serviceId: z.string().min(1).max(64),
  requestExpiry: z.number().int().positive().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { merchant } = await requireMerchantCsrfApi(request);
    const body = await readJson(request, schema);
    const key = request.headers.get("idempotency-key")?.trim();
    const result = createMerchantRequest({
      merchantId: merchant.merchantId,
      serviceId: body.serviceId,
      idempotencyKey: key || `merchant-${Date.now()}`,
      requestExpiry: body.requestExpiry,
    });
    return ok(
      { request: merchantRequestView(result.request), replayed: result.replayed },
      result.replayed ? 200 : 201,
    );
  });
}
