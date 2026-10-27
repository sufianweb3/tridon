import { ApiError, ok, withApi } from "@/lib/api";
import { currentMerchant } from "@/lib/server-auth";
import { merchantDashboard } from "@/lib/merchant";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withApi(async () => {
    const session = await currentMerchant();
    if (!session) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in as a merchant to continue.");
    }
    return ok({
      merchant: session.merchant,
      csrf: session.csrf,
      dashboard: merchantDashboard(session.merchant.merchantId),
    });
  });
}
