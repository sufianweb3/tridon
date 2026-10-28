import { z } from "zod";
import { ApiError, ok, readJson, requestIp, withApi } from "@/lib/api";
import { merchantFromBearer } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { createMerchantRequest, merchantRequestView } from "@/lib/merchant";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  service_id: z.string().min(1).max(64),
  request_expiry: z.number().int().positive().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const merchant = await merchantFromBearer(request);
    const limit = checkRateLimit(
      `merchant-api:${merchant.merchantId}:${requestIp(request)}`,
      appConfig.limits.agentRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Merchant request rate limit exceeded.");
    }
    const key = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!key) {
      throw new ApiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header so retries cannot create duplicate requests.",
      );
    }
    const body = await readJson(request, schema);
    const result = await createMerchantRequest({
      merchantId: merchant.merchantId,
      serviceId: body.service_id,
      idempotencyKey: key,
      requestExpiry: body.request_expiry,
    });
    return ok(
      {
        request: merchantRequestView(result.request),
        replayed: result.replayed,
        pay_with:
          "POST /v1/agent/payment-requests with merchant_id + service_id + Idempotency-Key",
      },
      result.replayed ? 200 : 201,
    );
  });
}
