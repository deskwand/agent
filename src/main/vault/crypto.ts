import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const AAD = Buffer.from("deskwand-vault-v1", "utf8");
const HKDF_SALT = Buffer.from("deskwand-vault-mek-v1", "utf8");

export function generateNonce(): Buffer {
  return randomBytes(12);
}

export function deriveMek(recoveryCode: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(recoveryCode, "utf8"),
      HKDF_SALT,
      Buffer.from("aes-256-gcm", "utf8"),
      32,
    ),
  );
}

export function encryptAes(plain: Buffer, key: Buffer, nonce: Buffer): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([enc, cipher.getAuthTag()]);
}

export function decryptAes(data: Buffer, key: Buffer, nonce: Buffer): Buffer {
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
