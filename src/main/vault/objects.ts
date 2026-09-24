import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { encryptAes, decryptAes, generateNonce } from "./crypto";

/**
 * 打包并加密文件 → payload 字节（nonce 前缀 || ciphertext+tag）。
 * 一次读取同时算出内容 sha256：上传路径只需要读一遍文件，
 * 返回值里的 `hash` 就是索引要记的内容版本。
 */
export async function packFile(
  filePath: string,
  mek: Buffer,
): Promise<{ payload: Buffer; id: string; hash: string }> {
  const plain = await readFile(filePath);
  const hash = createHash("sha256").update(plain).digest("hex");
  const nonce = generateNonce();
  const ct = encryptAes(plain, mek, nonce);
  return { payload: Buffer.concat([nonce, ct]), id: randomUUID(), hash };
}

/** 解密还原为原始字节。 */
export async function unpack(payload: Buffer, mek: Buffer): Promise<Buffer> {
  if (payload.length < 12 + 16) throw new Error("BAD_PAYLOAD");
  const nonce = payload.subarray(0, 12);
  const ct = payload.subarray(12);
  return decryptAes(ct, mek, nonce);
}
