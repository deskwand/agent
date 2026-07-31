import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeKeyStore, type RuntimeSecureStorage } from "../runtime-key-store";

// ---------------------------------------------------------------------------
// Fake secure storage for testing
// ---------------------------------------------------------------------------

class FakeSecureStorage implements RuntimeSecureStorage {
  available = true;
  throwOnDecrypt = false;

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(value: string): Buffer {
    return Buffer.from(`encrypted:${value}`, "utf8");
  }

  decryptString(value: Buffer): string {
    if (this.throwOnDecrypt) {
      throw new Error(
        "Error while decrypting the ciphertext provided to safeStorage.decryptString.",
      );
    }
    return value.toString("utf8").replace(/^encrypted:/, "");
  }
}

describe("RuntimeKeyStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots.length = 0;
  });

  async function createStore(): Promise<{
    root: string;
    storage: FakeSecureStorage;
    store: RuntimeKeyStore;
  }> {
    const root = await mkdtemp(join(tmpdir(), "runtime-key-"));
    roots.push(root);
    const storage = new FakeSecureStorage();
    return { root, storage, store: new RuntimeKeyStore(root, storage) };
  }

  // -----------------------------------------------------------------------
  // Round-trip
  // -----------------------------------------------------------------------

  it("generates, persists, and loads a stable 32-byte key", async () => {
    const { store } = await createStore();

    const key = await store.loadOrCreate();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);

    // Second call returns the same key
    const key2 = await store.loadOrCreate();
    expect(key2.equals(key)).toBe(true);
  });

  it("persists the key under channel-secrets with restrictive permissions", async () => {
    const { root, store } = await createStore();

    await store.loadOrCreate();

    const keyFile = join(root, "channel-secrets", "runtime-state-key.enc");
    const fileStat = await stat(keyFile);

    // Permission mask: only owner read/write (0o600)
    const perms = fileStat.mode & 0o777;
    expect(perms).toBe(0o600);

    // File content must not contain the raw key in any form
    const raw = await readFile(keyFile, "utf8");
    expect(raw).not.toContain("base64");
    // The key is double-encoded: key(32 bytes)→base64→encryptString→base64
    // so the raw key bytes are never in the file
  });

  it("survives a new store instance loading the same file", async () => {
    const { root, storage } = await createStore();
    const store1 = new RuntimeKeyStore(root, storage);
    const key1 = await store1.loadOrCreate();

    const store2 = new RuntimeKeyStore(root, storage);
    const key2 = await store2.loadOrCreate();

    expect(key1.equals(key2)).toBe(true);
  });

  it("returns one key to concurrent callers on the same store", async () => {
    const { store } = await createStore();
    const keys = await Promise.all(
      Array.from({ length: 20 }, () => store.loadOrCreate()),
    );
    expect(keys.every((key) => key.equals(keys[0]!))).toBe(true);
  });

  it("publishes one key across concurrent store instances", async () => {
    const { root, storage } = await createStore();
    const [first, second] = await Promise.all([
      new RuntimeKeyStore(root, storage).loadOrCreate(),
      new RuntimeKeyStore(root, storage).loadOrCreate(),
    ]);
    expect(first.equals(second)).toBe(true);
  });

  it("ignores an orphan temporary file from a crashed creator", async () => {
    const { root, storage } = await createStore();
    const secretsDir = join(root, "channel-secrets");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(secretsDir, "runtime-state-key.enc.crashed.tmp"),
      "partial",
      "utf8",
    );

    const key = await new RuntimeKeyStore(root, storage).loadOrCreate();
    expect(key).toHaveLength(32);
  });

  // -----------------------------------------------------------------------
  // Corruption
  // -----------------------------------------------------------------------

  it("throws RUNTIME_KEYSTORE_CORRUPT for a non-JSON key file", async () => {
    const { root, storage } = await createStore();

    // Pre-populate corrupt file
    const secretsDir = join(root, "channel-secrets");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    const keyFile = join(secretsDir, "runtime-state-key.enc");
    await writeFile(keyFile, "not-json", { encoding: "utf8" });

    const store = new RuntimeKeyStore(root, storage);
    await expect(store.loadOrCreate()).rejects.toThrow(
      "RUNTIME_KEYSTORE_CORRUPT",
    );
  });

  it("throws RUNTIME_KEYSTORE_CORRUPT for valid JSON with wrong key length", async () => {
    const { root, storage } = await createStore();

    // Write a payload with a 16-byte "key" instead of 32
    const secretsDir = join(root, "channel-secrets");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    const keyFile = join(secretsDir, "runtime-state-key.enc");

    // Simulate a shorter key: encrypt(base64(16 bytes))
    const shortKeyBase64 = Buffer.alloc(16, 1).toString("base64");
    const badCiphertext = storage
      .encryptString(shortKeyBase64)
      .toString("base64");
    await writeFile(
      keyFile,
      JSON.stringify({ version: 1, ciphertext: badCiphertext }),
      { encoding: "utf8" },
    );

    const store = new RuntimeKeyStore(root, storage);
    await expect(store.loadOrCreate()).rejects.toThrow(
      "RUNTIME_KEYSTORE_CORRUPT",
    );
  });

  it("auto-recovers when the stored ciphertext cannot be decrypted", async () => {
    const { root } = await createStore();
    // Use a separate storage that throws on decrypt to simulate the
    // OS-level decryption failure (e.g. Keychain cleared).
    const brokenStorage = new FakeSecureStorage();
    brokenStorage.throwOnDecrypt = true;

    const secretsDir = join(root, "channel-secrets");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    const keyFile = join(secretsDir, "runtime-state-key.enc");

    // Write a payload that looks valid but whose ciphertext cannot be
    // decrypted because the underlying safeStorage throws.
    await writeFile(
      keyFile,
      JSON.stringify({
        version: 1,
        ciphertext: Buffer.from("some-ciphertext").toString("base64"),
      }),
      { encoding: "utf8" },
    );

    // loadOrCreate should remove the orphaned file and create a fresh key.
    const store = new RuntimeKeyStore(root, brokenStorage);
    const key = await store.loadOrCreate();
    expect(key.length).toBe(32);

    // The orphaned file should have been removed and recreated.
    const { stat } = await import("node:fs/promises");
    const newStat = await stat(keyFile);
    expect(newStat.isFile()).toBe(true);
  });

  it("handles ENOENT by creating a fresh key (first run)", async () => {
    const { root, storage } = await createStore();
    // No key file exists — loadOrCreate must create one without error
    const store = new RuntimeKeyStore(root, storage);
    const key = await store.loadOrCreate();
    expect(key.length).toBe(32);

    // Second call should load the same key
    const key2 = await store.loadOrCreate();
    expect(key2.equals(key)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Unavailable encryption
  // -----------------------------------------------------------------------

  it("throws when safeStorage encryption is unavailable", async () => {
    const { root, storage } = await createStore();
    storage.available = false;

    const store = new RuntimeKeyStore(root, storage);
    await expect(store.loadOrCreate()).rejects.toThrow(
      "RUNTIME_KEYSTORE_ENCRYPTION_UNAVAILABLE",
    );
  });

  it("throws on unavailable encryption even when a key file exists", async () => {
    const { root, storage } = await createStore();

    // First, create a valid key with encryption available
    const store1 = new RuntimeKeyStore(root, storage);
    await store1.loadOrCreate();

    // Then, try to load with encryption unavailable
    storage.available = false;
    const store2 = new RuntimeKeyStore(root, storage);
    await expect(store2.loadOrCreate()).rejects.toThrow(
      "RUNTIME_KEYSTORE_ENCRYPTION_UNAVAILABLE",
    );
  });

  it("ignores an orphaned legacy lock file", async () => {
    const { root, storage } = await createStore();
    const secretsDir = join(root, "channel-secrets");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(secretsDir, "runtime-state-key.enc.lock"),
      "orphaned",
      { encoding: "utf8" },
    );

    const key = await new RuntimeKeyStore(root, storage).loadOrCreate();
    expect(key).toHaveLength(32);
  });
});
