import { z } from "zod";
import { ApiError, ok, readJson, withApi } from "@/lib/api";
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  webhookTest,
} from "@/lib/merchant";
import { requireMerchantApi, requireMerchantCsrfApi } from "@/lib/server-auth";

const createSchema = z.object({ url: z.string().url().max(2048) });
const deactivateSchema = z.object({ endpointId: z.string().min(1).max(64) });
const testSchema = z.object({ url: z.string().url().max(2048).optional() });

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { merchant } = await requireMerchantApi();
    return ok({
      endpoints: listWebhookEndpoints(merchant.merchantId),
      deliveries: listWebhookDeliveries(merchant.merchantId),
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { merchant } = await requireMerchantCsrfApi(request);
    const body = await readJson(request, createSchema);
    try {
      const result = createWebhookEndpoint({ merchantId: merchant.merchantId, url: body.url });
      return ok(
        {
          endpoint: result.endpoint,
          secret: result.secret,
          warning:
            "Copy the signing secret now. It is stored server-side for signing but is only returned once.",
        },
        201,
      );
    } catch (error) {
      throw new ApiError(
        400,
        "WEBHOOK_URL_REJECTED",
        error instanceof Error ? error.message : "Webhook endpoint rejected.",
      );
    }
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withApi(async () => {
    const { merchant } = await requireMerchantCsrfApi(request);
    const body = await readJson(request, deactivateSchema);
    const removed = deactivateWebhookEndpoint(merchant.merchantId, body.endpointId);
    return ok({ deactivated: removed });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return withApi(async () => {
    const { merchant } = await requireMerchantCsrfApi(request);
    const body = await readJson(request, testSchema);
    return ok(webhookTest({ merchantId: merchant.merchantId, url: body.url ?? null }));
  });
}
