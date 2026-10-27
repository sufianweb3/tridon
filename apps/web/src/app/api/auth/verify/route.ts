import { z } from "zod";
import { verifyNep413 } from "@agentspend/near";
import { ApiError, ok, readJson, requestIp, withApi } from "@/lib/api";
import {
  consumeAuthNonce,
  createUserSession,
  findOrCreateWalletUser,
  sessionCookie,
} from "@/lib/auth";
import { appConfig } from "@/lib/config";
import { ensureMockWorkspace } from "@/lib/platform";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  wallet: z.string().min(2).max(64),
  nonce: z.string().min(16).max(128),
  signature: z.string().min(32).max(256),
  publicKey: z.string().min(8).max(128),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const limit = checkRateLimit(
      `auth:verify:${requestIp(request)}`,
      appConfig.limits.authRequestsPerMinute,
      60_000,
    );
    if (!limit.ok) {
      throw new ApiError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again shortly.");
    }
    const body = await readJson(request, schema);
    const message = consumeAuthNonce(body.wallet, body.nonce);
    if (!message) {
      throw new ApiError(
        401,
        "NONCE_INVALID",
        "This sign-in challenge is invalid, expired or already used. Request a new one.",
      );
    }
    const recipientLine = message
      .split("\n")
      .find((line) => line.startsWith("Recipient: "));
    if (!recipientLine) {
      throw new ApiError(401, "NONCE_INVALID", "The stored challenge is malformed.");
    }
    const recipient = recipientLine.slice("Recipient: ".length).trim();

    try {
      await verifyNep413({
        accountId: body.wallet,
        publicKey: body.publicKey,
        message,
        recipient,
        nonce: Buffer.from(body.nonce, "base64"),
        signature: Buffer.from(body.signature, "base64"),
      });
    } catch (error) {
      throw new ApiError(
        401,
        "SIGNATURE_INVALID",
        error instanceof Error
          ? `The wallet signature could not be verified: ${error.message}`
          : "The wallet signature could not be verified.",
      );
    }

    const user = findOrCreateWalletUser(body.wallet);
    // Wallet sessions use the clearly labelled mock rail. The platform never
    // asks for, receives or stores this wallet's signing key.
    ensureMockWorkspace(user.id, body.wallet);
    const session = createUserSession({
      userId: user.id,
      wallet: body.wallet,
      authMethod: "nep413",
    });
    const response = ok({
      user,
      csrf: session.csrf,
      rail: "mock",
      railLabel: "Mock rail · backend-enforced limits",
    });
    response.headers.append(
      "set-cookie",
      sessionCookie(session.rawToken, Math.floor(appConfig.sessionTtlMs / 1000)),
    );
    return response;
  });
}
