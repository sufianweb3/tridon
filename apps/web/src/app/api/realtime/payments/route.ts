import { ApiError, ok, withApi } from "@/lib/api";
import { getRealtime, paymentsLiveQuery } from "@/lib/realtime";
import { requireUserApi } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Returns a short-lived sealed capability for the signed-in user's payments.
 * The capability is a bearer token for that exact query: keep it out of URLs
 * and logs. This endpoint never returns the Realtime secret.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const realtime = getRealtime();
    if (!realtime) {
      throw new ApiError(
        503,
        "REALTIME_NOT_CONFIGURED",
        "Neon Realtime is not configured on this deployment.",
      );
    }
    const sealed = await realtime.seal({ query: paymentsLiveQuery(user.id) });
    return ok(sealed);
  });
}
