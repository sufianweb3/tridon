import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

export function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomBytes(12).toString("base64url")}`;
}

export function randomToken(prefix: string, bytes = 24): string {
  return `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function tokenPrefix(token: string): string {
  return `${token.slice(0, 12)}…${token.slice(-4)}`;
}

export function base64url(buffer: Uint8Array | Buffer): string {
  return Buffer.from(buffer).toString("base64url");
}

export function fromBase64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function newNonce(): Buffer {
  return crypto.randomBytes(32);
}

export interface AuthMessageInput {
  wallet: string;
  nonce: string;
  issuedAt: string;
  recipient: string;
}

export function authMessage(input: AuthMessageInput): string {
  return [
    "AgentSpend wants you to sign in with your NEAR account.",
    "",
    `Wallet: ${input.wallet}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Recipient: ${input.recipient}`,
  ].join("\n");
}

let cachedMasterKey: Buffer | undefined;

/**
 * Server-local 32-byte key for encrypting demo signing keys at rest.
 * Production deployments must set AGENTSPEND_MASTER_KEY in a secret manager.
 * The fallback file is generated on first run, is gitignored, and never leaves
 * the machine.
 */
export function masterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const envKey = process.env.AGENTSPEND_MASTER_KEY;
  if (envKey) {
    const decoded = Buffer.from(envKey, "base64");
    if (decoded.length !== 32) {
      throw new Error("AGENTSPEND_MASTER_KEY must be 32 bytes base64-encoded");
    }
    cachedMasterKey = decoded;
    return decoded;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, "master.key");
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length !== 32) throw new Error("master.key must be 32 bytes");
    cachedMasterKey = existing;
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const generated = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, generated, { flag: "wx", mode: 0o600 });
    cachedMasterKey = generated;
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = fs.readFileSync(keyPath);
      cachedMasterKey = existing;
      return existing;
    }
    throw error;
  }
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(secret.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** HMAC for signed merchant webhooks: t=<unix>,v1=<hex>. */
export function webhookSignature(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|token|key|signature|authorization/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = redact(item);
      }
    }
    return output;
  }
  return value;
}
