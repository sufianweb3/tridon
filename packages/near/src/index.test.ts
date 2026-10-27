import { describe, expect, it } from "vitest";
import {
  ONE_YOCTO,
  STORAGE_DEPOSIT_YOCTO,
  TESTNET,
  TGAS,
  explorerAccountUrl,
  explorerTxUrl,
  generateKey,
  publicKeyOf,
} from "./index";

describe("near constants", () => {
  it("exposes testnet configuration only", () => {
    expect(TESTNET.networkId).toBe("testnet");
    expect(TESTNET.rpcUrl).toMatch(/^https:\/\//);
    expect(TESTNET.helperUrl).toMatch(/^https:\/\//);
  });

  it("uses integer base units", () => {
    expect(TGAS).toBe(1_000_000_000_000n);
    expect(ONE_YOCTO).toBe(1n);
    expect(STORAGE_DEPOSIT_YOCTO).toBe(1_250_000_000_000_000_000_000n);
  });
});

describe("key handling", () => {
  it("generates an ed25519 secret key and a matching public key", () => {
    const key = generateKey();
    expect(key.secretKey).toMatch(/^ed25519:/);
    expect(key.publicKey).toMatch(/^ed25519:/);
    expect(publicKeyOf(key.secretKey)).toBe(key.publicKey);
  });

  it("derives the same public key every time", () => {
    const key = generateKey();
    expect(publicKeyOf(key.secretKey)).toBe(publicKeyOf(key.secretKey));
  });

  it("generates a distinct key pair per call", () => {
    const first = generateKey();
    const second = generateKey();
    expect(first.secretKey).not.toBe(second.secretKey);
    expect(first.publicKey).not.toBe(second.publicKey);
  });

  it("rejects a malformed secret key", () => {
    expect(() => publicKeyOf("not-a-key")).toThrow();
  });
});

describe("explorer urls", () => {
  it("links transactions on the testnet explorer", () => {
    expect(explorerTxUrl("abc123")).toBe("https://testnet.nearblocks.io/txns/abc123");
  });

  it("links accounts on the testnet explorer", () => {
    expect(explorerAccountUrl("as-vault-mvpk1qc46z3b.testnet")).toBe(
      "https://testnet.nearblocks.io/address/as-vault-mvpk1qc46z3b.testnet",
    );
  });
});
