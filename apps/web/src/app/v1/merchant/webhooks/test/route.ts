import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { merchantFromBearer } from "@/lib/auth";
import { webhookTest } from "@/lib/merchant";

const schema = z.object({ url: z.string().url().max(2048).optional() });

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const merchant = merchantFromBearer(request);
    const body = await readJson(request, schema);
    return ok(webhookTest({ merchantId: merchant.merchantId, url: body.url ?? null }));
  });
}
