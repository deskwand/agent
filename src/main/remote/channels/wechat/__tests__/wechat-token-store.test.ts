import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SecureWeChatTokenStore,
  type WeChatSecureStorage,
} from "../wechat-token-store";

class FakeSecureStorage implements WeChatSecureStorage {
  available = true;
  isEncryptionAvailable(): boolean {
    return this.available;
  }
  encryptString(value: string): Buffer {
    return Buffer.from(`encrypted:${value}`, "utf8");
  }
  decryptString(value: Buffer): string {
    return value.toString("utf8").replace(/^encrypted:/, "");
  }
}

describe("SecureWeChatTokenStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots.length = 0;
  });

  async function createStore() {
    const root = await mkdtemp(join(tmpdir(), "wechat-token-"));
    roots.push(root);
    const storage = new FakeSecureStorage();
    return { root, storage, store: new SecureWeChatTokenStore(root, storage) };
  }

  it("round-trips encrypted credentials with restrictive permissions", async () => {
    const { root, store } = await createStore();
    await store.save("wechat-1", "serialized-credential");

    expect(await store.load("wechat-1")).toBe("serialized-credential");
    const file = join(root, "wechat-1.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).not.toContain("serialized-credential");
  });

  it("fails closed when secure storage is unavailable", async () => {
    const { storage, store } = await createStore();
    storage.available = false;

    await expect(store.save("wechat-1", "secret")).rejects.toThrow(
      "WECHAT_SECURE_STORAGE_UNAVAILABLE",
    );
  });

  it("rejects path traversal instance identifiers", async () => {
    const { store } = await createStore();
    await expect(store.save("../escape", "secret")).rejects.toThrow(
      "WECHAT_INVALID_INSTANCE_ID",
    );
  });
});
