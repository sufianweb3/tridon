import { ok, withApi } from "@/lib/api";
import {
  MERCHANT_COOKIE,
  clearMerchantCookie,
  deleteMerchantSession,
} from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const cookie = request.headers.get("cookie") ?? "";
    const match = new RegExp(`(?:^|;\\s*)${MERCHANT_COOKIE}=([^;]+)`).exec(cookie);
    await deleteMerchantSession(match?.[1] ?? null);
    const response = ok({ signedOut: true });
    response.headers.append("set-cookie", clearMerchantCookie());
    return response;
  });
}
