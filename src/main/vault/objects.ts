import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { encryptAes, decryptAes, generateNonce } from "./crypto";

/** 打包并加密文件 → payload 字节（nonce 前缀 || ciphertext+tag）。 */
export async function packFile(
  filePath: string,
  mek: Buffer,
): Promise<{ payload: Buffer; id: string }> {
  const plain = await readFile(filePath);
  const nonce = generateNonce();
  const ct = encryptAes(plain, mek, nonce);
  return { payload: Buffer.concat([nonce, ct]), id: randomUUID() };
}

/** 解密还原为原始字节。 */
export async function unpack(payload: Buffer, mek: Buffer): Promise<Buffer> {
  if (payload.length < 12 + 16) throw new Error("BAD_PAYLOAD");
  const nonce = payload.subarray(0, 12);
  const ct = payload.subarray(12);
  return decryptAes(ct, mek, nonce);
}
