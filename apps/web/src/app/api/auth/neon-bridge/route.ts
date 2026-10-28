import { ApiError, ok, withApi } from "@/lib/api";
import { appConfig } from "@/lib/config";
import { createUserSession, findOrCreateNeonUser, sessionCookie } from "@/lib/auth";
import { getNeonAuth } from "@/lib/neon-auth";
import { ensureMockWorkspace } from "@/lib/platform";

/**
 * Bridges a Neon Auth session (email + password, managed by Neon) into the
 * application's own HttpOnly session cookie.
 *
 * This is deliberately additive: demo and NEP-413 wallet sign-in are unchanged.
 * An email account gets a backend-only mock workspace, clearly labelled as such.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const auth = getNeonAuth();
    if (!auth) {
      throw new ApiError(
        503,
        "NEON_AUTH_NOT_CONFIGURED",
        "Neon Auth is not configured on this deployment.",
      );
    }

    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      if (originHost !== new URL(request.url).host) {
        throw new ApiError(403, "ORIGIN_MISMATCH", "Cross-origin sign-in is not allowed.");
      }
    }

    const { data: session, error } = await auth.getSession();
    const email = session?.user?.email;
    if (error || !session?.user?.id || !email) {
      throw new ApiError(
        401,
        "NEON_SESSION_REQUIRED",
        "Sign in with your email account before opening the workspace.",
      );
    }

    const user = await findOrCreateNeonUser({
      neonUserId: session.user.id,
      email,
      name: session.user.name,
    });
    await ensureMockWorkspace(user.id, email);

    const appSession = await createUserSession({
      userId: user.id,
      wallet: "",
      authMethod: "neon-auth",
    });
    const response = ok({
      user,
      csrf: appSession.csrf,
      rail: "mock",
      railLabel: "Mock rail - backend-enforced limits",
    });
    response.headers.append(
      "set-cookie",
      sessionCookie(appSession.rawToken, Math.floor(appConfig.sessionTtlMs / 1000)),
    );
    return response;
  });
}
