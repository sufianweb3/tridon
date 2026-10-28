import { execute, now, queryOne, setting } from "./db";
import {
  constantTimeEqualHex,
  hashToken,
  newNonce,
  randomId,
  randomToken,
  sha256Hex,
} from "./crypto";
import { appConfig } from "./config";

export interface AuthUser {
  id: string;
  wallet: string;
  displayName: string;
  role: string;
}

export interface UserSession {
  id: string;
  userId: string;
  wallet: string;
  csrf: string;
  authMethod: string;
  expiresAt: number;
}

export interface AgentAuth {
  agentId: string;
  agentName: string;
  agentStatus: string;
  userId: string;
  userWallet: string;
  vaultId: string | null;
  credentialId: string;
}

export interface MerchantAuth {
  merchantId: string;
  merchantName: string;
  payoutAccount: string;
  credentialId: string;
}

export const SESSION_COOKIE = "agentspend_session";
export const MERCHANT_COOKIE = "agentspend_merchant";
export const CSRF_HEADER = "x-csrf-token";

export function sessionCookie(rawToken: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function merchantCookie(rawToken: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MERCHANT_COOKIE}=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearMerchantCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MERCHANT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export async function userFromSessionToken(rawToken: string | null): Promise<{
  user: AuthUser;
  session: UserSession;
} | null> {
  if (!rawToken) return null;
  const sessionId = hashToken(rawToken);
  const row = await queryOne<{
    id: string;
    user_id: string;
    wallet: string;
    csrf: string;
    auth_method: string;
    expires_at: number;
    display_name: string;
    role: string;
  }>(
    `SELECT s.id, s.user_id, s.wallet, s.csrf, s.auth_method, s.expires_at,
            u.display_name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [sessionId],
  );
  if (!row) return null;
  if (row.expires_at <= now()) {
    await execute("DELETE FROM sessions WHERE id = ?", [sessionId]);
    return null;
  }
  return {
    user: {
      id: row.user_id,
      wallet: row.wallet,
      displayName: row.display_name,
      role: row.role,
    },
    session: {
      id: row.id,
      userId: row.user_id,
      wallet: row.wallet,
      csrf: row.csrf,
      authMethod: row.auth_method,
      expiresAt: row.expires_at,
    },
  };
}

export async function userFromCookieHeader(cookieHeader: string | null): Promise<{
  user: AuthUser;
  session: UserSession;
} | null> {
  return userFromSessionToken(cookieValue(cookieHeader, SESSION_COOKIE));
}

export async function merchantFromCookieHeader(cookieHeader: string | null): Promise<{
  merchant: MerchantAuth;
  csrf: string;
  expiresAt: number;
} | null> {
  const raw = cookieValue(cookieHeader, MERCHANT_COOKIE);
  if (!raw) return null;
  const id = hashToken(raw);
  const row = await queryOne<{
    id: string;
    merchant_id: string;
    csrf: string;
    expires_at: number;
    name: string;
    payout_account: string;
  }>(
    `SELECT ms.id, ms.merchant_id, ms.csrf, ms.expires_at, m.name, m.payout_account
     FROM merchant_sessions ms JOIN merchants m ON m.id = ms.merchant_id
     WHERE ms.id = ?`,
    [id],
  );
  if (!row) return null;
  if (row.expires_at <= now()) {
    await execute("DELETE FROM merchant_sessions WHERE id = ?", [id]);
    return null;
  }
  return {
    merchant: {
      merchantId: row.merchant_id,
      merchantName: row.name,
      payoutAccount: row.payout_account,
      credentialId: "",
    },
    csrf: row.csrf,
    expiresAt: row.expires_at,
  };
}

export async function createUserSession(input: {
  userId: string;
  wallet: string;
  authMethod: string;
  ttlMs?: number;
}): Promise<{ rawToken: string; csrf: string; expiresAt: number }> {
  const rawToken = randomToken("sess_", 32);
  const csrf = randomToken("csrf_", 24);
  const createdAt = now();
  const expiresAt = createdAt + (input.ttlMs ?? appConfig.sessionTtlMs);
  await execute(
    `INSERT INTO sessions (id, user_id, wallet, csrf, auth_method, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(rawToken), input.userId, input.wallet, csrf, input.authMethod, createdAt, expiresAt],
  );
  return { rawToken, csrf, expiresAt };
}

export async function createMerchantSession(merchantId: string): Promise<{
  rawToken: string;
  csrf: string;
  expiresAt: number;
}> {
  const rawToken = randomToken("msess_", 32);
  const csrf = randomToken("mcsrf_", 24);
  const createdAt = now();
  const expiresAt = createdAt + appConfig.merchantSessionTtlMs;
  await execute(
    `INSERT INTO merchant_sessions (id, merchant_id, csrf, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [hashToken(rawToken), merchantId, csrf, createdAt, expiresAt],
  );
  return { rawToken, csrf, expiresAt };
}

export async function deleteSession(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await execute("DELETE FROM sessions WHERE id = ?", [hashToken(rawToken)]);
}

export async function deleteMerchantSession(rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await execute("DELETE FROM merchant_sessions WHERE id = ?", [hashToken(rawToken)]);
}

export function csrfMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function findOrCreateWalletUser(wallet: string): Promise<AuthUser> {  const existing = await queryOne<{
    id: string;
    wallet: string;
    display_name: string;
    role: string;
  }>("SELECT id, wallet, display_name, role FROM users WHERE wallet = ?", [wallet]);
  if (existing) {
    return {
      id: existing.id,
      wallet: existing.wallet,
      displayName: existing.display_name,
      role: existing.role,
    };
  }
  const id = randomId("usr_");
  const displayName = wallet.split(".")[0] ?? wallet;
  await execute(
    "INSERT INTO users (id, wallet, display_name, role, created_at) VALUES (?, ?, ?, 'user', ?)",
    [id, wallet, displayName, now()],
  );
  await execute(
    "INSERT INTO wallet_connections (id, user_id, wallet, provider, network, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [randomId("wc_"), id, wallet, "near-connect", "testnet", now()],
  );
  return { id, wallet, displayName, role: "user" };
}

export interface NeonIdentity {
  neonUserId: string;
  email: string;
  name?: string | null;
}

/**
 * Maps a Neon Auth identity onto the application's own users table. Neon is the
 * credential store; the app still owns its session, CSRF token and workspace.
 * The `wallet` column stays NULL because a Neon account is not a NEAR account.
 */
export async function findOrCreateNeonUser(identity: NeonIdentity): Promise<AuthUser> {
  const email = identity.email.trim().toLowerCase();
  const existing = await queryOne<{
    id: string;
    wallet: string | null;
    display_name: string;
    role: string;
    neon_user_id: string | null;
  }>(
    `SELECT id, wallet, display_name, role, neon_user_id
     FROM users WHERE neon_user_id = ? OR email = ? LIMIT 1`,
    [identity.neonUserId, email],
  );
  if (existing) {
    if (!existing.neon_user_id) {
      await execute("UPDATE users SET neon_user_id = ? WHERE id = ?", [
        identity.neonUserId,
        existing.id,
      ]);
    }
    return {
      id: existing.id,
      wallet: existing.wallet ?? "",
      displayName: existing.display_name,
      role: existing.role,
    };
  }
  const id = randomId("usr_");
  const displayName =
    identity.name?.trim() || email.split("@")[0] || "Neon account";
  await execute(
    `INSERT INTO users (id, wallet, email, neon_user_id, display_name, role, created_at)
     VALUES (?, NULL, ?, ?, ?, 'user', ?)`,
    [id, email, identity.neonUserId, displayName, now()],
  );
  return { id, wallet: "", displayName, role: "user" };
}

export interface IssuedNonce {
  nonce: string;
  message: string;
  issuedAt: string;
  recipient: string;
  expiresAt: number;
}

export async function issueAuthNonce(wallet: string): Promise<IssuedNonce> {
  const nonce = newNonce().toString("base64");
  const issuedAt = new Date().toISOString();
  const recipient = appConfig.appUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "localhost:3000";
  const message = [
    "AgentSpend wants you to sign in with your NEAR account.",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Recipient: ${recipient}`,
  ].join("\n");
  const createdAt = now();
  const expiresAt = createdAt + appConfig.nonceTtlMs;
  await execute(
    `INSERT INTO auth_nonces (nonce, wallet, message, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [nonce, wallet, message, createdAt, expiresAt],
  );
  return { nonce, message, issuedAt, recipient, expiresAt };
}

/**
 * Single-use nonce. Returns the stored message when the nonce is valid for this
 * wallet; null otherwise. The conditional UPDATE is atomic, so a nonce can be
 * consumed by exactly one verifier even under concurrent requests.
 */
export async function consumeAuthNonce(wallet: string, nonce: string): Promise<string | null> {
  const row = await queryOne<{ message: string }>(
    `UPDATE auth_nonces SET used_at = ?
     WHERE nonce = ? AND wallet = ? AND used_at IS NULL AND expires_at > ?
     RETURNING message`,
    [now(), nonce, wallet, now()],
  );
  return row?.message ?? null;
}

export async function purgeExpiredNonces(): Promise<void> {
  await execute("DELETE FROM auth_nonces WHERE expires_at < ?", [now()]);
}

export async function agentFromBearer(request: Request): Promise<AgentAuth> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(asp_agent_[A-Za-z0-9_-]+)$/.exec(header);
  if (!match?.[1]) {
    throw new AgentAuthError(401, "UNAUTHENTICATED", "A valid agent bearer credential is required.");
  }
  const tokenHash = hashToken(match[1]);
  const row = await queryOne<{
    credential_id: string;
    credential_revoked_at: number | null;
    agent_id: string;
    agent_name: string;
    agent_status: string;
    user_id: string;
    wallet: string;
    vault_id: string | null;
  }>(
    `SELECT ac.id AS credential_id, ac.revoked_at AS credential_revoked_at,
            a.id AS agent_id, a.name AS agent_name, a.status AS agent_status,
            a.user_id, u.wallet, a.vault_id
     FROM agent_credentials ac
     JOIN agents a ON a.id = ac.agent_id
     JOIN users u ON u.id = a.user_id
     WHERE ac.token_hash = ?`,
    [tokenHash],
  );
  if (!row) {
    throw new AgentAuthError(401, "UNAUTHENTICATED", "A valid agent bearer credential is required.");
  }
  if (row.credential_revoked_at !== null) {
    throw new AgentAuthError(403, "CREDENTIAL_REVOKED", "This agent credential has been revoked.");
  }
  if (row.agent_status !== "active") {
    throw new AgentAuthError(403, "AGENT_REVOKED", "This agent has been revoked.");
  }
  await execute("UPDATE agent_credentials SET last_used_at = ? WHERE id = ?", [
    now(),
    row.credential_id,
  ]);
  return {
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentStatus: row.agent_status,
    userId: row.user_id,
    userWallet: row.wallet,
    vaultId: row.vault_id,
    credentialId: row.credential_id,
  };
}

export class AgentAuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function merchantFromBearer(request: Request): Promise<MerchantAuth> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(asp_merchant_[A-Za-z0-9_-]+)$/.exec(header);
  if (!match?.[1]) {
    throw new AgentAuthError(401, "UNAUTHENTICATED", "A valid merchant bearer credential is required.");
  }
  const row = await queryOne<{
    credential_id: string;
    revoked_at: number | null;
    merchant_id: string;
    name: string;
    payout_account: string;
  }>(
    `SELECT mc.id AS credential_id, mc.revoked_at, m.id AS merchant_id, m.name, m.payout_account
     FROM merchant_api_credentials mc JOIN merchants m ON m.id = mc.merchant_id
     WHERE mc.token_hash = ?`,
    [hashToken(match[1])],
  );
  if (!row || row.revoked_at !== null) {
    throw new AgentAuthError(401, "UNAUTHENTICATED", "A valid merchant bearer credential is required.");
  }
  return {
    merchantId: row.merchant_id,
    merchantName: row.name,
    payoutAccount: row.payout_account,
    credentialId: row.credential_id,
  };
}

export async function demoUser(): Promise<AuthUser | null> {
  const demoUserId = await setting("demo.user_id", "");
  if (!demoUserId) return null;
  const row = await queryOne<{
    id: string;
    wallet: string;
    display_name: string;
    role: string;
  }>("SELECT id, wallet, display_name, role FROM users WHERE id = ?", [demoUserId]);
  if (!row) return null;
  return {
    id: row.id,
    wallet: row.wallet,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function demoMerchantId(): Promise<string> {
  return setting("demo.merchant_id", "merchant-data");
}

export function credentialLookupHash(token: string): string {
  return sha256Hex(token);
}

export function safeCompare(a: string, b: string): boolean {
  return constantTimeEqualHex(a, b);
}
