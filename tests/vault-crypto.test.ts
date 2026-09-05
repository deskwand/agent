import { describe, it, expect } from "vitest";
import {
  encryptAes,
  decryptAes,
  deriveMek,
  generateNonce,
} from "../src/main/vault/crypto";

describe("vault crypto", () => {
  const mek = deriveMek("RECOVERY-CODE-XXXX");

  it("deriveMek is deterministic and 32 bytes", () => {
    expect(mek.length).toBe(32);
    expect(deriveMek("RECOVERY-CODE-XXXX").equals(mek)).toBe(true);
    expect(deriveMek("OTHER").equals(mek)).toBe(false);
  });

  it("encrypt→decrypt round trip", () => {
    const nonce = generateNonce();
    const plain = Buffer.from("hello 加密 base 场景");
    const ct = encryptAes(plain, mek, nonce);
    expect(decryptAes(ct, mek, nonce).toString()).toBe("hello 加密 base 场景");
  });

  it("decrypt fails with wrong key", () => {
    const nonce = generateNonce();
    const ct = encryptAes(Buffer.from("secret"), mek, nonce);
    expect(() => decryptAes(ct, deriveMek("WRONG"), nonce)).toThrow();
  });

  it("nonce is 12 bytes and unique", () => {
    expect(generateNonce().length).toBe(12);
    expect(generateNonce().equals(generateNonce())).toBe(false);
  });
});
