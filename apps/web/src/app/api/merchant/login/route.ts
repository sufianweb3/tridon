import { z } from "zod";
import { ApiError, ok, readJson, requestIp, withApi } from "@/lib/api";
import { createMerchantSession, merchantCookie } from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({ merchantId: z.string().min(1).max(64) });

/**
 * Labelled demo merchant sign-in. Real merchant accounts would authenticate
 * with a merchant API key or an organization SSO; this shortcut exists only in
 * demo mode and never touches funds.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    if (!appConfig.demoEnabled) {
      throw new ApiError(404, "DEMO_DISABLED", "Demo merchant sign-in is disabled.");
    }
    const limit = checkRateLimit(
      `merchant:login:${requestIp(request)}`,
      appConfig.limits.authRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
    }
    const { merchantId } = await readJson(request, schema);
    const merchant = await queryOne<{ id: string; name: string; payout_account: string }>(
      "SELECT id, name, payout_account FROM merchants WHERE id = ? AND active = 1",
      [merchantId],
    );
    if (!merchant) {
      throw new ApiError(404, "MERCHANT_NOT_FOUND", "Merchant not found.");
    }
    const session = await createMerchantSession(merchant.id);
    const response = ok({
      merchant: {
        id: merchant.id,
        name: merchant.name,
        payoutAccount: merchant.payout_account,
      },
      csrf: session.csrf,
      warning: "Demo merchant session. This is testnet data, not a production merchant login.",
    });
    response.headers.append(
      "set-cookie",
      merchantCookie(session.rawToken, Math.floor(appConfig.merchantSessionTtlMs / 1000)),
    );
    return response;
  });
}
