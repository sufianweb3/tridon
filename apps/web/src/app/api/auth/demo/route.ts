import { ApiError, ok, withApi } from "@/lib/api";
import {
  createUserSession,
  demoUser,
  sessionCookie,
} from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { setting } from "@/lib/db";

/**
 * Labelled demo sign-in. It only exists when the operator has provisioned the
 * testnet demo workspace. It never creates a real user wallet session.
 */
export async function POST(): Promise<Response> {
  return withApi(async () => {
    if (!appConfig.demoEnabled) {
      throw new ApiError(404, "DEMO_DISABLED", "Demo sign-in is disabled.");
    }
    const user = await demoUser();
    if (!user || (await setting("demo.vault.initialized", "")) !== "1") {
      throw new ApiError(
        409,
        "DEMO_NOT_SEEDED",
        "The demo workspace is not ready. Run `pnpm seed` first.",
      );
    }
    const session = await createUserSession({
      userId: user.id,
      wallet: user.wallet,
      authMethod: "demo",
    });
    const response = ok({
      user,
      csrf: session.csrf,
      rail: "testnet",
      railLabel: "NEAR testnet · on-chain vault",
      warning:
        "Demo mode. The server holds the testnet owner and agent keys for this workspace. Never use this pattern with real funds.",
    });
    response.headers.append(
      "set-cookie",
      sessionCookie(session.rawToken, Math.floor(appConfig.sessionTtlMs / 1000)),
    );
    return response;
  });
}
