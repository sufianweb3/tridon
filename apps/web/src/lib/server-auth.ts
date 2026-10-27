import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MERCHANT_COOKIE,
  SESSION_COOKIE,
  merchantFromCookieHeader,
  userFromCookieHeader,
  type AuthUser,
  type MerchantAuth,
  type UserSession,
} from "./auth";
import { ApiError, assertCsrf } from "./api";

function cookieHeaderFromStore(store: Awaited<ReturnType<typeof cookies>>): string {
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function currentSession(): Promise<{
  user: AuthUser;
  session: UserSession;
} | null> {
  const store = await cookies();
  return userFromCookieHeader(cookieHeaderFromStore(store));
}

export async function requireUserPage(): Promise<{ user: AuthUser; session: UserSession }> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireUserApi(request: Request): Promise<{
  user: AuthUser;
  session: UserSession;
}> {
  const session = userFromCookieHeader(request.headers.get("cookie"));
  if (!session) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  return session;
}

export async function requireCsrfApi(request: Request): Promise<{
  user: AuthUser;
  session: UserSession;
}> {
  const auth = await requireUserApi(request);
  assertCsrf(request, auth.session.csrf);
  return auth;
}

export async function currentMerchant(): Promise<{
  merchant: MerchantAuth;
  csrf: string;
  expiresAt: number;
} | null> {
  const store = await cookies();
  return merchantFromCookieHeader(cookieHeaderFromStore(store));
}

export async function requireMerchantPage(): Promise<{
  merchant: MerchantAuth;
  csrf: string;
  expiresAt: number;
}> {
  const merchant = await currentMerchant();
  if (!merchant) redirect("/merchant/login");
  return merchant;
}

export async function requireMerchantApi(): Promise<{
  merchant: MerchantAuth;
  csrf: string;
  expiresAt: number;
}> {
  const session = await currentMerchant();
  if (!session) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in as a merchant to continue.");
  }
  return session;
}

export async function requireMerchantCsrfApi(request: Request): Promise<{
  merchant: MerchantAuth;
  csrf: string;
  expiresAt: number;
}> {
  const session = await requireMerchantApi();
  assertCsrf(request, session.csrf);
  return session;
}

export const AUTH_COOKIE_NAMES = { SESSION_COOKIE, MERCHANT_COOKIE } as const;
