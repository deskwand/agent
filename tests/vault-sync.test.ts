import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { decodeRemoteIndex } from "../src/main/vault/vault-index";
import {
  LocalVaultStore,
  type LocalVaultIndex,
} from "../src/main/vault/local-store";
import {
  VaultResetService,
  VaultSyncService,
  type VaultCloudClient,
} from "../src/main/vault/sync";

const mek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

class FakeCloudClient implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  readonly deletedObjectIds: string[] = [];
  indexPayload: Buffer | null = null;
  failObjectUpload = false;
  failObjectDelete = false;
  failIndex = false;
  failList = false;
  onObjectUpload: (() => Promise<void> | void) | null = null;
  indexUploads = 0;

  async putObject(
    _token: string,
    objectId: string,
    payload: Buffer,
  ): Promise<void> {
    if (this.failObjectUpload) throw new Error("NETWORK_DOWN");
    this.objects.set(objectId, Buffer.from(payload));
    await this.onObjectUpload?.();
  }

  async getObject(_token: string, objectId: string): Promise<Buffer> {
    const payload = this.objects.get(objectId);
    if (!payload) throw new Error("NOT_FOUND");
    return payload;
  }

  async deleteObject(_token: string, objectId: string): Promise<void> {
    if (this.failObjectDelete) throw new Error("NETWORK_DOWN");
    this.objects.delete(objectId);
    this.deletedObjectIds.push(objectId);
  }

  async getIndex(_token: string): Promise<Buffer | null> {
    return this.indexPayload;
  }

  async putIndex(_token: string, payload: Buffer): Promise<void> {
    if (this.failIndex) throw new Error("NETWORK_DOWN");
    this.indexPayload = Buffer.from(payload);
    this.indexUploads += 1;
  }

  async listObjectIds(): Promise<string[]> {
    if (this.failList) throw new Error("NETWORK_DOWN");
    return [...this.objects.keys()];
  }
}

describe("VaultSyncService", () => {
  const roots: string[] = [];

  async function createStore(): Promise<LocalVaultStore> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-sync-"));
    roots.push(root);
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    return store;
  }

  async function cleanup(): Promise<void> {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  }

  it("blocks sync while a destructive reset marker exists", async () => {
    const store = await createStore();
    await store.writeOperationMarker({
      version: 1,
      id: "reset-1",
      kind: "reset",
      state: "resetting",
    });
    const service = new VaultSyncService(
      store,
      new FakeCloudClient(),
      () => mek,
    );

    await expect(service.sync("token")).rejects.toThrow(
      "VAULT_RESET_IN_PROGRESS",
    );
    await cleanup();
  });

  it("backs up a pending local file and marks it synced", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "readme.md"), "hello");
    await store.reconcile(await store.readIndex());
    const index = await store.reconcile(await store.readIndex());
    await store.writeIndex(index);
    const cloud = new FakeCloudClient();
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    const synced = await store.readIndex();
    expect(result.uploaded).toBe(1);
    expect(synced.files["readme.md"].syncStatus).toBe("synced");
    expect(synced.files["readme.md"].objectId).toEqual(expect.any(String));
    expect(cloud.indexPayload).not.toBeNull();
    expect(
      decodeRemoteIndex(cloud.indexPayload!, mek).files["readme.md"],
    ).toBeDefined();
    await cleanup();
  });

  it("keeps local data failed and retries after a cloud failure", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "retry.txt"), "retry");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.failObjectUpload = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    const failed = await service.sync("token");
    expect(failed.failed).toBe(1);
    expect(await readFile(join(store.rootDir, "retry.txt"), "utf8")).toBe(
      "retry",
    );
    expect((await store.readIndex()).files["retry.txt"].syncStatus).toBe(
      "failed",
    );

    cloud.failObjectUpload = false;
    const retried = await service.sync("token");
    expect(retried.uploaded).toBe(1);
    expect((await store.readIndex()).files["retry.txt"].syncStatus).toBe(
      "synced",
    );
    await cleanup();
  });

  it("publishes a new object before deleting the old one", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "change.txt"), "old");
    const oldIndex: LocalVaultIndex = {
      version: 1,
      files: {
        "change.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    };
    await store.writeIndex(oldIndex);
    const cloud = new FakeCloudClient();
    cloud.objects.set("old-object", Buffer.from("old-ciphertext"));
    await writeFile(join(store.rootDir, "change.txt"), "new");
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    const next = await store.readIndex();
    expect(result.deleted).toBe(1);
    expect(next.files["change.txt"].objectId).not.toBe("old-object");
    expect(cloud.objects.has("old-object")).toBe(false);
    expect(next.pendingDeletes).toEqual([]);
    await cleanup();
  });

  it("does not delete the old object when the new index upload fails", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "change.txt"), "old");
    await store.writeIndex({
      version: 1,
      files: {
        "change.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });
    await writeFile(join(store.rootDir, "change.txt"), "new");
    const cloud = new FakeCloudClient();
    cloud.objects.set("old-object", Buffer.from("old-ciphertext"));
    cloud.failIndex = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    await service.sync("token");

    expect(cloud.objects.has("old-object")).toBe(true);
    expect((await store.readIndex()).pendingDeletes).toEqual(["old-object"]);
    await cleanup();
  });

  it("retains a failed old-object deletion for retry", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "change.txt"), "old");
    await store.writeIndex({
      version: 1,
      files: {
        "change.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });
    await writeFile(join(store.rootDir, "change.txt"), "new");
    const cloud = new FakeCloudClient();
    cloud.objects.set("old-object", Buffer.from("old-ciphertext"));
    cloud.failObjectDelete = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    await service.sync("token");

    expect((await store.readIndex()).pendingDeletes).toEqual(["old-object"]);
    await cleanup();
  });

  it("does not mark an upload synced when the file changes during upload", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "race.txt"), "before");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.onObjectUpload = () =>
      writeFile(join(store.rootDir, "race.txt"), "after");
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    expect(result.pending).toBe(1);
    expect(result.deleted).toBe(1);
    expect(cloud.objects.size).toBe(0);
    expect((await store.readIndex()).files["race.txt"].syncStatus).toBe(
      "pending",
    );
    await cleanup();
  });

  it("queues a second sync call behind an active sync", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "queued.txt"), "before");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    let releaseUpload!: () => void;
    let startedUpload!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      startedUpload = resolve;
    });
    const uploadBlocked = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let uploadCalls = 0;
    cloud.onObjectUpload = async () => {
      uploadCalls += 1;
      if (uploadCalls === 1) {
        await writeFile(join(store.rootDir, "queued.txt"), "after");
        startedUpload();
        await uploadBlocked;
      }
    };
    const service = new VaultSyncService(store, cloud, () => mek);

    const first = service.sync("token");
    await uploadStarted;
    const second = service.sync("token");
    releaseUpload();

    await first;
    const secondResult = await second;
    expect(secondResult.uploaded).toBe(1);
    expect(uploadCalls).toBe(2);
    await cleanup();
  });

  it("does not change local files when MEK is unavailable", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "offline.txt"), "local");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    const service = new VaultSyncService(store, cloud, () => null);

    await expect(service.sync("token")).rejects.toThrow("VAULT_KEY_REQUIRED");
    expect(await readFile(join(store.rootDir, "offline.txt"), "utf8")).toBe(
      "local",
    );
    await cleanup();
  });

  it("keeps local files pending when the remote index request fails", async () => {
    const store = await createStore();
    await writeFile(join(store.rootDir, "keep.txt"), "depends");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.failIndex = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    expect(result.pending).toBeGreaterThan(0);
    expect((await store.readIndex()).files["keep.txt"].syncStatus).toBe(
      "failed",
    );
    await cleanup();
  });

  describe("VaultResetService", () => {
    it("preserves local files while preparing a new remote backup", async () => {
      const store = await createStore();
      await writeFile(store.filePath("keep.txt"), "local");
      await writeFile(store.filePath("notes.txt"), "notes");
      await store.writeIndex({
        version: 1,
        files: {
          "keep.txt": {
            objectId: "old-1",
            hash: "h1",
            size: 5,
            mtime: 1,
            syncStatus: "synced",
            objectHash: "h1",
          },
          "notes.txt": {
            objectId: "old-2",
            hash: "h2",
            size: 5,
            mtime: 1,
            syncStatus: "synced",
            objectHash: "h2",
          },
        },
        pendingDeletes: [],
      });
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher1"));
      cloud.objects.set("old-2", Buffer.from("cipher2"));
      const resetService = new VaultResetService(
        store,
        cloud,
        () => mek,
        () => {},
      );

      const preparation =
        await resetService.beginDiscardAndReinitialize("token");
      expect(preparation.recoveryCode).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
      expect(preparation.preservedLocalFiles).toBe(2);
      expect(await readFile(store.filePath("keep.txt"), "utf8")).toBe("local");
      expect(cloud.deletedObjectIds).toEqual(["old-1", "old-2"]);

      const result = await resetService.completeDiscardAndReinitialize(
        "token",
        preparation.recoveryCode,
      );
      expect(result.deletedObjects).toBe(2);
      expect(cloud.indexPayload).not.toBeNull();
      expect(
        decodeRemoteIndex(
          cloud.indexPayload!,
          deriveMek(preparation.recoveryCode),
        ).files,
      ).toEqual({});
      expect((await store.readIndex()).files["keep.txt"].syncStatus).toBe(
        "pending",
      );
      await cleanup();
    });

    it("resumes an interrupted reset instead of treating its marker as permanent", async () => {
      const store = await createStore();
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
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher"));
      cloud.failObjectDelete = true;
      const first = new VaultResetService(
        store,
        cloud,
        () => mek,
        () => {},
      );
      await expect(first.beginDiscardAndReinitialize("token")).rejects.toThrow(
        "VAULT_RESET_FAILED",
      );

      cloud.failObjectDelete = false;
      const restarted = new VaultResetService(
        store,
        cloud,
        () => mek,
        () => {},
      );
      const preparation = await restarted.beginDiscardAndReinitialize("token");
      expect(preparation.preservedLocalFiles).toBe(1);
      expect(cloud.deletedObjectIds).toEqual(["old-1"]);
      await cleanup();
    });

    it("does not switch MEK when old-object cleanup fails", async () => {
      const store = await createStore();
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
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher"));
      cloud.failObjectDelete = true;
      const oldMek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");
      let storedMek: Buffer | null = oldMek;
      const resetService = new VaultResetService(
        store,
        cloud,
        () => storedMek,
        (next) => {
          storedMek = next;
        },
      );

      await expect(
        resetService.beginDiscardAndReinitialize("token"),
      ).rejects.toThrow("VAULT_RESET_FAILED");
      expect(storedMek).toEqual(oldMek);
      expect(await readFile(store.filePath("keep.txt"), "utf8")).toBe("local");
      await cleanup();
    });

    it("does not persist a new MEK when the recovery code mismatches", async () => {
      const store = await createStore();
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
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher"));
      const oldMek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");
      let storedMek: Buffer | null = oldMek;
      const resetService = new VaultResetService(
        store,
        cloud,
        () => storedMek,
        (next) => {
          storedMek = next;
        },
      );

      const preparation =
        await resetService.beginDiscardAndReinitialize("token");
      await expect(
        resetService.completeDiscardAndReinitialize("token", "WRONG_CODE"),
      ).rejects.toThrow("VAULT_RECOVERY_MISMATCH");
      expect(storedMek).toEqual(oldMek);
      await cleanup();
    });

    it("keeps a no-key reset retryable when object listing fails", async () => {
      const store = await createStore();
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher"));
      cloud.failList = true;
      const resetService = new VaultResetService(
        store,
        cloud,
        () => null,
        () => {},
      );

      await expect(
        resetService.discardWithoutLocalKey("token"),
      ).rejects.toThrow("VAULT_RESET_FAILED");
      expect((await store.readOperationMarker())?.state).toBe("resetting");
      cloud.failList = false;
      await resetService.discardWithoutLocalKey("token");
      expect((await store.readOperationMarker())?.state).toBe(
        "awaiting-recovery-code",
      );
      await cleanup();
    });

    it("does not re-delete objects on restart with an awaiting-recovery-code marker", async () => {
      const store = await createStore();
      const cloud = new FakeCloudClient();
      cloud.objects.set("old-1", Buffer.from("cipher"));
      const resetService = new VaultResetService(
        store,
        cloud,
        () => null,
        () => {},
      );
      await resetService.discardWithoutLocalKey("token");
      const deletedAfterFirst = [...cloud.deletedObjectIds];
      expect(deletedAfterFirst).toEqual(["old-1"]);

      const restarted = new VaultResetService(
        store,
        cloud,
        () => null,
        () => {},
      );
      const result = await restarted.discardWithoutLocalKey("token");
      expect(cloud.deletedObjectIds).toEqual(deletedAfterFirst);
      expect(result.deletedObjects).toBe(0);
      const marker = await store.readOperationMarker();
      expect(marker?.state).toBe("awaiting-recovery-code");
      await cleanup();
    });
  });
});
