import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packFile, unpack } from "../src/main/vault/objects";
import { deriveMek } from "../src/main/vault/crypto";

describe("vault objects", () => {
  const mek = deriveMek("TEST-CODE-1234");
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "vault-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("packs a file and unpacks byte-identical", async () => {
    const src = join(dir, "skill.zip");
    const data = Buffer.from("fake skill zip bytes");
    writeFileSync(src, data);
    const { payload } = await packFile(src, mek);
    const restored = await unpack(payload, mek);
    expect(restored.equals(data)).toBe(true);
  });

  it("unpack fails with wrong key", async () => {
    const src = join(dir, "skill2.zip");
    writeFileSync(src, Buffer.from("x"));
    const { payload } = await packFile(src, mek);
    await expect(unpack(payload, deriveMek("WRONG"))).rejects.toThrow();
  });
});
