import { z } from "zod";
import { ApiError, ok, readJson, requestIp, withApi } from "@/lib/api";
import { appConfig } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueAuthNonce, purgeExpiredNonces } from "@/lib/auth";

const schema = z.object({
  wallet: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]{0,62})\.testnet$/, "Use a NEAR testnet account."),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const limit = checkRateLimit(
      `auth:nonce:${requestIp(request)}`,
      appConfig.limits.authRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
    }
    const { wallet } = await readJson(request, schema);
    await purgeExpiredNonces();
    const issued = await issueAuthNonce(wallet);
    return ok(issued);
  });
}
