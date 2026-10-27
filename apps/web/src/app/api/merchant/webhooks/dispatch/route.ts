import { ok, withApi } from "@/lib/api";
import { dispatchPendingWebhooks } from "@/lib/webhooks";
import { requireMerchantCsrfApi } from "@/lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    await requireMerchantCsrfApi(request);
    const delivered = await dispatchPendingWebhooks(10);
    return ok({
      delivered,
      note:
        "Delivery is disabled unless AGENTSPEND_WEBHOOK_HOSTS contains the endpoint host. Redirects are refused.",
    });
  });
}
