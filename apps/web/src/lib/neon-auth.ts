import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Managed Better Auth) is additive. The existing demo and NEP-413
 * wallet sessions keep working; this is a second, clearly labelled way to get
 * a backend-only mock workspace.
 *
 * The singleton is created lazily so a deployment that has not pulled the Neon
 * Auth environment can still build and serve the existing sign-in methods.
 */
type NeonAuth = ReturnType<typeof createNeonAuth>;

let instance: NeonAuth | null = null;

export function neonAuthConfigured(): boolean {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET ?? "";
  return Boolean(process.env.NEON_AUTH_BASE_URL) && secret.length >= 32;
}

export function getNeonAuth(): NeonAuth | null {
  if (!neonAuthConfigured()) return null;
  if (!instance) {
    instance = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
    });
  }
  return instance;
}
