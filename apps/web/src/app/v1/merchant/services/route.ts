import { z } from "zod";
import { ApiError, ok, readJson, withApi } from "@/lib/api";
import { merchantFromBearer } from "@/lib/auth";
import { createMerchantService } from "@/lib/merchant";
import { decimalToUnits } from "@/lib/validation";

const schema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(240).default(""),
  price: z.string().min(1).max(32),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const merchant = await merchantFromBearer(request);
    const body = await readJson(request, schema);
    const price = decimalToUnits(body.price, "Price");
    if (BigInt(price) > 10_000_000_000n) {
      throw new ApiError(400, "INVALID_AMOUNT", "Demo service prices are capped at $10,000.");
    }
    const service = await createMerchantService({
      merchantId: merchant.merchantId,
      name: body.name,
      description: body.description,
      price,
    });
    return ok({ service, asset: "TESTUSD", network: "testnet" }, 201);
  });
}
