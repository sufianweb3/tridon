import { z } from "zod";
import { ApiError, ok, readJson, requestIp, withApi } from "@/lib/api";
import { agentFromBearer } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { createPayment, getApprovalForPayment } from "@/lib/payments";
import { checkRateLimit } from "@/lib/rate-limit";
import { decimalSchema, decimalToUnits } from "@/lib/validation";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

const schema = z.object({
  merchant_id: z.string().min(1).max(64),
  service_id: z.string().min(1).max(64).optional(),
  amount: decimalSchema.optional(),
  request_expiry: z.number().int().positive().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const agent = await agentFromBearer(request);
    const limit = checkRateLimit(
      `agent:${agent.agentId}:${requestIp(request)}`,
      appConfig.limits.agentRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Agent request rate limit exceeded.");
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey) {
      throw new ApiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header. The same key never creates a second charge.",
      );
    }
    const body = await readJson(request, schema);
    const amountGross = body.amount ? decimalToUnits(body.amount, "amount") : undefined;

    const result = await createPayment({
      userId: agent.userId,
      agentId: agent.agentId,
      merchantId: body.merchant_id,
      serviceId: body.service_id ?? null,
      amountGross: amountGross ? BigInt(amountGross) : null,
      idempotencyKey,
      requestExpiry: body.request_expiry,
      actor: "agent",
    });

    const approval = await getApprovalForPayment(result.payment.id);
    const view = await paymentView(result.payment);
    const status =
      result.payment.status === "awaiting_approval"
        ? 202
        : result.payment.status === "unknown"
          ? 202
          : result.payment.status === "denied"
            ? 200
            : result.payment.status === "failed"
              ? 200
              : 201;
    const response = ok(
      {
        payment: view,
        approval: approval
          ? {
              id: approval.id,
              status: approval.status,
              approvalHash: approval.approval_hash,
              expiresAt: approval.expires_at,
            }
          : null,
        idempotent_replay: result.replayed,
        enforcement: view.enforcement,
        note:
          result.payment.status === "unknown"
            ? "Settlement is unverified. Do not fulfill the service until this payment becomes succeeded."
            : result.payment.status === "awaiting_approval"
              ? "A human must approve this payment before settlement."
              : undefined,
      },
      status,
    );
    response.headers.set("idempotency-replayed", result.replayed ? "true" : "false");
    return response;
  });
}

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    await agentFromBearer(request);
    return ok({ hint: "Use POST to create a payment request." });
  });
}
