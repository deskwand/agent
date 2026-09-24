import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { encodeRemoteIndex } from "../src/main/vault/vault-index";
import { LocalVaultStore } from "../src/main/vault/local-store";
import {
  VaultResetService,
  VaultRestoreService,
  VaultSyncService,
  type VaultCloudClient,
} from "../src/main/vault/sync";
import { packFile } from "../src/main/vault/objects";
import type { VaultIndexScope } from "../src/main/vault/cloud-client";

const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const mek = deriveMek(code);

class FakeCloud implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  /** 按 scope 分桶：列表接口是 scope 级的，替身必须能区分。 */
  readonly objectsByScope = new Map<VaultIndexScope, Map<string, Buffer>>();
  index: Buffer | null = null;
  failUploads = false;

  async putObject(
    _token: string,
    scope: VaultIndexScope,
    id: string,
    payload: Buffer,
  ): Promise<void> {
    if (this.failUploads) throw new Error("NETWORK_DOWN");
    this.objects.set(id, Buffer.from(payload));
    const bucket = this.objectsByScope.get(scope) ?? new Map<string, Buffer>();
    bucket.set(id, Buffer.from(payload));
    this.objectsByScope.set(scope, bucket);
  }

  async getObject(_token: string, id: string): Promise<Buffer> {
    const payload = this.objects.get(id);
    if (!payload) throw new Error("NOT_FOUND");
    return payload;
  }

  async deleteObject(_token: string, id: string): Promise<void> {
    this.objects.delete(id);
  }

  async getIndex(
    _token: string,
    _scope: VaultIndexScope,
  ): Promise<Buffer | null> {
    return this.index;
  }

  async putIndex(
    _token: string,
    _scope: VaultIndexScope,
    payload: Buffer,
  ): Promise<void> {
    this.index = Buffer.from(payload);
  }

  async listObjectIds(
    _token: string,
    scope: VaultIndexScope,
  ): Promise<string[]> {
    const bucket = this.objectsByScope.get(scope);
    return bucket ? [...bucket.keys()] : [];
  }
}

describe("Vault local-first acceptance flow", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
    await rm("/tmp/deskwand-test/vault/vault-mek.bin", { force: true });
  });

  it("keeps local authority through backup failure and restores encrypted backup", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "deskwand-vault-e2e-"));
    roots.push(sourceRoot);
    const store = new LocalVaultStore(join(sourceRoot, "vault"));
    const cloud = new FakeCloud();
    await store.ensureDirectory();
    const source = join(sourceRoot, "document.md");
    await writeFile(source, "v1");

    const imported = await store.importFile(source);
    expect(imported.name).toBe("document.md");
    expect((await store.readIndex()).files["document.md"].syncStatus).toBe(
      "pending",
    );

    const service = new VaultSyncService(store, cloud, () => mek);
    await service.sync("token");
    const firstObject = (await store.readIndex()).files["document.md"].objectId;
    expect(firstObject).not.toBeNull();

    await writeFile(store.filePath("document.md"), "v2");
    await service.sync("token");
    const secondObject = (await store.readIndex()).files["document.md"]
      .objectId;
    expect(secondObject).not.toBe(firstObject);
    expect(firstObject && cloud.objects.has(firstObject)).toBe(false);

    await store.deleteFile("document.md");
    expect((await store.scanFiles()).map((file) => file.name)).toEqual([]);
    await service.sync("token");
    expect(cloud.objects.size).toBe(0);

    cloud.failUploads = true;
    await writeFile(source, "offline");
    await store.importFile(source);
    const failed = await service.sync("token");
    expect(failed.failed).toBe(1);
    expect(await readFile(store.filePath("document.md"), "utf8")).toBe(
      "offline",
    );

    const remoteSource = join(sourceRoot, "remote.md");
    await writeFile(remoteSource, "remote");
    const packed = await packFile(remoteSource, mek);
    cloud.failUploads = false;
    cloud.objects.set(packed.id, packed.payload);
    cloud.index = encodeRemoteIndex(
      {
        version: 1,
        files: {
          "document.md": {
            objectId: packed.id,
            hash: "remote-hash",
            size: 6,
            mtime: 1,
          },
        },
      },
      mek,
    );

    const restoredRoot = await mkdtemp(join(tmpdir(), "deskwand-vault-fresh-"));
    roots.push(restoredRoot);
    const restoredStore = new LocalVaultStore(join(restoredRoot, "vault"));
    await restoredStore.ensureDirectory();
    const restored = await new VaultRestoreService(
      restoredStore,
      cloud,
      () => mek,
      () => {},
    ).restoreWithRecoveryCode("token", code);

    expect(restored).toEqual({ restored: 1, renamed: 0 });
    expect(await readFile(restoredStore.filePath("document.md"), "utf8")).toBe(
      "remote",
    );
  });

  it("discards old objects on a new device and writes a fresh empty index", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "deskwand-vault-reset-"));
    roots.push(sourceRoot);
    const store = new LocalVaultStore(join(sourceRoot, "vault"));
    await store.ensureDirectory();
    const cloud = new FakeCloud();
    // 走真实上传路径播种：列表接口按 scope 分仓，直接塞 objects 不会进分桶，
    // 那样测的就不是服务端的行为。
    await cloud.putObject("token", "files", "old-1", Buffer.from("cipher"));

    const resetService = new VaultResetService(
      store,
      cloud,
      () => null,
      () => {},
    );
    const result = await resetService.discardWithoutLocalKey("token");

    expect(result.deletedObjects).toBe(1);
    expect(cloud.objects.size).toBe(0);
    expect((await store.readOperationMarker())?.state).toBe(
      "awaiting-recovery-code",
    );
  });

  it("preserves local files when reinitializing the backup", async () => {
    const sourceRoot = await mkdtemp(
      join(tmpdir(), "deskwand-vault-reset-local-"),
    );
    roots.push(sourceRoot);
    const store = new LocalVaultStore(join(sourceRoot, "vault"));
    await store.ensureDirectory();
    await writeFile(store.filePath("keep.txt"), "local");
    await store.writeIndex({
      version: 1,
      files: {
        "keep.txt": {
          objectId: "old-1",
          hash: "h",
          size: 5,
          mtime: 1,
          syncStatus: "synced",
          objectHash: "h",
        },
      },
      pendingDeletes: [],
    });
    const cloud = new FakeCloud();
    cloud.objects.set("old-1", Buffer.from("cipher"));

    const resetService = new VaultResetService(
      store,
      cloud,
      () => mek,
      () => {},
    );
    const preparation = await resetService.beginDiscardAndReinitialize("token");
    const result = await resetService.completeDiscardAndReinitialize(
      "token",
      preparation.recoveryCode,
    );

    expect(result.preservedLocalFiles).toBe(1);
    expect(await readFile(store.filePath("keep.txt"), "utf8")).toBe("local");
    expect((await store.readIndex()).files["keep.txt"].syncStatus).toBe(
      "pending",
    );
  });
});
