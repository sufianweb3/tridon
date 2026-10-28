import { ok, withApi } from "@/lib/api";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  deleteSession,
} from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const cookie = request.headers.get("cookie") ?? "";
    const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookie);
    await deleteSession(match?.[1] ?? null);
    const response = ok({ signedOut: true });
    response.headers.append("set-cookie", clearSessionCookie());
    return response;
  });
}
