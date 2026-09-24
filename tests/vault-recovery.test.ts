import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateRecoveryCode,
  validateRecoveryCode,
} from "../src/main/vault/recovery";
import { deriveMek } from "../src/main/vault/crypto";
import { encodeRemoteIndex } from "../src/main/vault/vault-index";
import {
  hasStoredMek,
  initializeNewMek,
  loadMek,
  verifyAndStoreMek,
} from "../src/main/vault/keychain";
import { packFile } from "../src/main/vault/objects";
import { LocalVaultStore } from "../src/main/vault/local-store";
import {
  VaultRestoreService,
  type VaultCloudClient,
} from "../src/main/vault/sync";

describe("vault recovery", () => {
  const mekPath = "/tmp/deskwand-test/vault/vault-mek.bin";

  beforeEach(() => {
    rmSync(mekPath, { force: true });
  });

  afterEach(() => {
    rmSync(mekPath, { force: true });
  });

  it("generates a valid base58 code", () => {
    const code = generateRecoveryCode();
    expect(validateRecoveryCode(code)).toBe(true);
    expect(code.length).toBeGreaterThanOrEqual(24);
  });

  it("rejects invalid codes", () => {
    expect(validateRecoveryCode("0O1l")).toBe(false);
    expect(validateRecoveryCode("short")).toBe(false);
    expect(validateRecoveryCode("")).toBe(false);
  });

  it("deriveMek is deterministic per code", () => {
    const code = generateRecoveryCode();
    expect(deriveMek(code).equals(deriveMek(code))).toBe(true);
  });

  it("verifies before persisting and allows a correct retry", () => {
    const correctCode = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const wrongCode = "abcdefghijkmnopqrstuvwxyz123456789";
    const payload = encodeRemoteIndex(
      {
        version: 2,
        files: {
          "files/readme.md": {
            objectId: "remote-1",
            hash: "hash",
            size: 5,
            mtime: 1,
          },
        },
      },
      deriveMek(correctCode),
    );

    expect(() => verifyAndStoreMek(wrongCode, payload)).toThrow(
      "VAULT_RECOVERY_MISMATCH",
    );
    expect(loadMek()).toBeNull();

    verifyAndStoreMek(correctCode, payload);
    expect(loadMek()).not.toBeNull();
  });

  it("reports key presence without requiring decryption", () => {
    expect(hasStoredMek()).toBe(false);
    initializeNewMek(generateRecoveryCode());
    expect(hasStoredMek()).toBe(true);
  });

  it("stores a newly generated MEK after explicit confirmation", () => {
    const code = generateRecoveryCode();

    initializeNewMek(code);

    expect(loadMek()).not.toBeNull();
  });

  it("does not replace an existing MEK during setup", () => {
    const firstCode = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const secondCode = "abcdefghijkmnopqrstuvwxyz123456789";
    initializeNewMek(firstCode);

    expect(() => initializeNewMek(secondCode)).toThrow(
      "VAULT_ALREADY_INITIALIZED",
    );
    expect(loadMek()?.equals(deriveMek(firstCode))).toBe(true);
  });

  it("does not replace an existing MEK during remote verification", () => {
    const firstCode = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const secondCode = "abcdefghijkmnopqrstuvwxyz123456789";
    initializeNewMek(firstCode);
    const payload = encodeRemoteIndex(
      { version: 2, files: {} },
      deriveMek(secondCode),
    );

    expect(() => verifyAndStoreMek(secondCode, payload)).toThrow(
      "VAULT_ALREADY_INITIALIZED",
    );
    expect(loadMek()?.equals(deriveMek(firstCode))).toBe(true);
  });

  it("restores encrypted files from a cloud backup", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskwand-vault-restore-"));
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const source = join(root, "remote-readme.md");
    writeFileSync(source, "remote");
    const { id, payload } = await packFile(
      source,
      deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ"),
    );

    class FakeCloud implements VaultCloudClient {
      async putObject(): Promise<void> {}
      async putIndex(): Promise<void> {}
      async deleteObject(): Promise<void> {}
      async listObjectIds(): Promise<string[]> {
        return [];
      }
      async getIndex(): Promise<Buffer> {
        return encodeRemoteIndex(
          {
            version: 2,
            files: {
              "files/readme.md": {
                objectId: id,
                hash: "remote-hash",
                size: 6,
                mtime: 1,
              },
            },
          },
          deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ"),
        );
      }
      async getObject(): Promise<Buffer> {
        return payload;
      }
    }

    let persisted: Buffer | null = null;
    const result = await new VaultRestoreService(
      store,
      new FakeCloud(),
      () => null,
      (mek) => {
        persisted = mek;
      },
    ).restoreWithRecoveryCode("token", "123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

    expect(result).toEqual({ restored: 1, renamed: 0 });
    expect(
      persisted?.equals(deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ")),
    ).toBe(true);
    expect(await readFile(store.filePath("files/readme.md"), "utf8")).toBe("remote");
    rmSync(root, { recursive: true, force: true });
  });

  it("restores with the stored MEK without a recovery code", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskwand-vault-restore-mek-"));
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const source = join(root, "readme.md");
    writeFileSync(source, "hello");
    const { id, payload } = await packFile(source, deriveMek(code));
    const cloud: VaultCloudClient = {
      putObject: async () => {},
      putIndex: async () => {},
      deleteObject: async () => {},
      listObjectIds: async () => [],
      getIndex: async () =>
        encodeRemoteIndex(
          {
            version: 2,
            files: {
              "files/readme.md": {
                objectId: id,
                hash: "hash",
                size: 5,
                mtime: 1,
              },
            },
          },
          deriveMek(code),
        ),
      getObject: async () => payload,
    };

    const service = new VaultRestoreService(
      store,
      cloud,
      () => deriveMek(code),
      () => {},
    );
    const result = await service.restoreWithLocalMek("token");

    expect(result.restored).toBe(1);
    expect(await readFile(store.filePath("files/readme.md"), "utf8")).toBe("hello");
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects recovery-code restore before touching local files when a different MEK exists", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "deskwand-vault-restore-existing-mek-"),
    );
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const otherCode = "abcdefghijkmnopqrstuvwxyz123456789";
    let downloaded = false;
    const cloud: VaultCloudClient = {
      putObject: async () => {},
      putIndex: async () => {},
      deleteObject: async () => {},
      listObjectIds: async () => [],
      getIndex: async () =>
        encodeRemoteIndex(
          {
            version: 2,
            files: {
              "files/readme.md": {
                objectId: "remote-readme",
                hash: "hash",
                size: 5,
                mtime: 1,
              },
            },
          },
          deriveMek(code),
        ),
      getObject: async () => {
        downloaded = true;
        throw new Error("download must not run");
      },
    };

    await expect(
      new VaultRestoreService(
        store,
        cloud,
        () => deriveMek(otherCode),
        () => {
          throw new Error("MEK must not be persisted");
        },
      ).restoreWithRecoveryCode("token", code),
    ).rejects.toThrow("VAULT_ALREADY_INITIALIZED");
    expect(downloaded).toBe(false);
    expect(await store.scanFiles()).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("indexes every remote file and skips internal names", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskwand-vault-restore-multi-"));
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const restoreCode = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const firstSource = join(root, "first.md");
    const secondSource = join(root, "second.md");
    writeFileSync(firstSource, "first");
    writeFileSync(secondSource, "second");
    const first = await packFile(firstSource, deriveMek(restoreCode));
    const second = await packFile(secondSource, deriveMek(restoreCode));
    const objects = new Map([
      [first.id, first.payload],
      [second.id, second.payload],
    ]);
    const cloud: VaultCloudClient = {
      putObject: async () => {},
      putIndex: async () => {},
      deleteObject: async () => {},
      listObjectIds: async () => [],
      getIndex: async () =>
        encodeRemoteIndex(
          {
            version: 2,
            files: {
              "files/report.md": {
                objectId: first.id,
                hash: "first-hash",
                size: 5,
                mtime: 1,
              },
              "files/report (1).md": {
                objectId: second.id,
                hash: "second-hash",
                size: 6,
                mtime: 1,
              },
            },
          },
          deriveMek(restoreCode),
        ),
      getObject: async (_token, objectId) => {
        const payload = objects.get(objectId);
        if (!payload) throw new Error("NOT_FOUND");
        return payload;
      },
    };

    const result = await new VaultRestoreService(
      store,
      cloud,
      () => null,
      () => {},
    ).restoreWithRecoveryCode("token", restoreCode);

    expect(result.restored).toBe(2);
    const index = await store.readIndex();
    expect(index.files["files/report.md"]).toBeDefined();
    expect(index.files["files/report (1).md"]).toBeDefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("does not persist a MEK when restoring object download fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "deskwand-vault-restore-fail-"));
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let storedMek: Buffer | null = null;
    const cloud: VaultCloudClient = {
      putObject: async () => {},
      putIndex: async () => {},
      deleteObject: async () => {},
      listObjectIds: async () => [],
      getIndex: async () =>
        encodeRemoteIndex(
          {
            version: 2,
            files: {
              "files/missing.txt": {
                objectId: "missing-object",
                hash: "hash",
                size: 1,
                mtime: 1,
              },
            },
          },
          deriveMek(code),
        ),
      getObject: async () => {
        throw new Error("NETWORK_DOWN");
      },
    };

    const service = new VaultRestoreService(
      store,
      cloud,
      () => null,
      (next) => {
        storedMek = next;
      },
    );
    await expect(
      service.restoreWithRecoveryCode("token", code),
    ).rejects.toThrow("NETWORK_DOWN");
    expect(storedMek).toBeNull();
    expect(await store.readOperationMarker()).toBeNull();
    expect(await store.scanFiles()).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
