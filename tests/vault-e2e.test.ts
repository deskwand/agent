import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { packFile, unpack } from "../src/main/vault/objects";

describe("vault e2e: server never sees plaintext", () => {
  const mek = deriveMek("CODE-abcdefghijklmnopqrstuvwxyz");
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vault-e2e-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("ciphertext contains no plaintext and only correct MEK decrypts", async () => {
    const src = join(dir, "skill.zip");
    const data = Buffer.from("real skill zip content");
    writeFileSync(src, data);

    const { payload, id } = await packFile(src, mek);
    // 密文中不含原文（服务端拿到的 payload 是密文，解不出明文）
    expect(payload.includes(Buffer.from("real skill zip content"))).toBe(false);

    // 正确 MEK 还原
    const restored = await unpack(payload, mek);
    expect(restored.equals(data)).toBe(true);

    // 错误 MEK 解不出
    await expect(unpack(payload, deriveMek("WRONG-CODE"))).rejects.toThrow();
  });
});
