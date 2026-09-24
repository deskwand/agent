import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import {
  FetchVaultCloudClient,
  VaultCloudError,
} from "../src/main/vault/cloud-client";
import { DESKWAND_API_URL } from "../src/shared/oauth-config";

// 计数「同步到底读了几次文件内容」：local-store 用的是 ESM 具名导入，
// `vi.spyOn(fsPromises, "readFile")` 拦不住。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const mek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

class FakeCloudClient implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  readonly deletedObjectIds: string[] = [];
  indexPayload: Buffer | null = null;
  failObjectUpload = false;
  failObjectUploadCode: string | null = null;
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
    if (this.failObjectUploadCode) {
      throw new VaultCloudError(413, this.failObjectUploadCode);
    }
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

  async listObjectIds(_token: string): Promise<string[]> {
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

  /** 按根相对路径（`files/x`、`skills/x`）把夹具写进对应模块。 */
  async function seedFile(
    store: LocalVaultStore,
    name: string,
    contents: string,
  ): Promise<void> {
    await mkdir(dirname(store.filePath(name)), { recursive: true });
    await writeFile(store.filePath(name), contents);
  }

  async function cleanup(): Promise<void> {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  }

  it("scans a skills tree only once while syncing multiple files", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-tree-scan-"));
    roots.push(root);
    const store = new LocalVaultStore(join(root, "vault"));
    await mkdir(join(store.rootDir, "skills", "foo"), { recursive: true });
    await writeFile(join(store.rootDir, "skills", "foo", "A.md"), "a");
    await writeFile(join(store.rootDir, "skills", "foo", "B.md"), "b");
    const scan = vi.spyOn(store, "scanFiles");
    const cloud = new FakeCloudClient();
    const result = await new VaultSyncService(store, cloud, () => mek).sync(
      "token",
    );
    expect(result.uploaded).toBe(2);
    expect(scan).toHaveBeenCalledTimes(1);
    scan.mockRestore();
    await cleanup();
  });

  it("targets the single index slot and uploads objects without a scope", async () => {
    const store = await createStore();
    await seedFile(store, "files/readme.md", "hello");
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await new VaultSyncService(
        store,
        new FetchVaultCloudClient(),
        () => mek,
      ).sync("token");
      expect(result.uploaded).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    // 远端只有 /api/vault/index 一个索引槽，对象接口按 id 寻址、无 scope。
    expect(urls).toContain(`${DESKWAND_API_URL}/api/vault/index`);
    expect(urls.some((url) => url.includes("/api/vault/objects/"))).toBe(true);
    expect(urls.every((url) => !url.includes("scope="))).toBe(true);
    await cleanup();
  });

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
    await seedFile(store, "files/readme.md", "hello");
    await store.reconcile(await store.readIndex());
    const index = await store.reconcile(await store.readIndex());
    await store.writeIndex(index);
    const cloud = new FakeCloudClient();
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    const synced = await store.readIndex();
    expect(result.uploaded).toBe(1);
    expect(synced.files["files/readme.md"].syncStatus).toBe("synced");
    expect(synced.files["files/readme.md"].objectId).toEqual(
      expect.any(String),
    );
    expect(cloud.indexPayload).not.toBeNull();
    expect(
      decodeRemoteIndex(cloud.indexPayload!, mek).files["files/readme.md"],
    ).toBeDefined();
    await cleanup();
  });

  it("keeps local data failed and retries after a cloud failure", async () => {
    const store = await createStore();
    await seedFile(store, "files/retry.txt", "retry");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.failObjectUpload = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    const failed = await service.sync("token");
    expect(failed.failed).toBe(1);
    expect(await readFile(store.filePath("files/retry.txt"), "utf8")).toBe(
      "retry",
    );
    expect((await store.readIndex()).files["files/retry.txt"].syncStatus).toBe(
      "failed",
    );

    cloud.failObjectUpload = false;
    const retried = await service.sync("token");
    expect(retried.uploaded).toBe(1);
    expect((await store.readIndex()).files["files/retry.txt"].syncStatus).toBe(
      "synced",
    );
    await cleanup();
  });

  it("publishes a new object before deleting the old one", async () => {
    const store = await createStore();
    await seedFile(store, "files/change.txt", "old");
    const oldIndex: LocalVaultIndex = {
      version: 2,
      files: {
        "files/change.txt": {
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
    await seedFile(store, "files/change.txt", "new");
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    const next = await store.readIndex();
    expect(result.deleted).toBe(1);
    expect(next.files["files/change.txt"].objectId).not.toBe("old-object");
    expect(cloud.objects.has("old-object")).toBe(false);
    expect(next.pendingDeletes).toEqual([]);
    await cleanup();
  });

  it("does not delete the old object when the new index upload fails", async () => {
    const store = await createStore();
    await seedFile(store, "files/change.txt", "old");
    await store.writeIndex({
      version: 2,
      files: {
        "files/change.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });
    await seedFile(store, "files/change.txt", "new");
    const cloud = new FakeCloudClient();
    cloud.objects.set("old-object", Buffer.from("old-ciphertext"));
    cloud.failIndex = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    await service.sync("token");

    expect(cloud.objects.has("old-object")).toBe(true);
    expect(cloud.objects.size).toBe(1);
    expect((await store.readIndex()).files["files/change.txt"].objectId).toBe(
      "old-object",
    );
    expect((await store.readIndex()).pendingDeletes).toEqual(["old-object"]);
    await cleanup();
  });

  it("surfaces a cloud quota error while keeping the local entry pending", async () => {
    const store = await createStore();
    await seedFile(store, "files/quota.txt", "local");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.failObjectUploadCode = "VAULT_QUOTA_EXCEEDED";
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    expect(result.errorCode).toBe("VAULT_QUOTA_EXCEEDED");
    expect((await store.readIndex()).files["files/quota.txt"].syncStatus).toBe(
      "failed",
    );
    await cleanup();
  });

  it("retains a failed old-object deletion for retry", async () => {
    const store = await createStore();
    await seedFile(store, "files/change.txt", "old");
    await store.writeIndex({
      version: 2,
      files: {
        "files/change.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });
    await seedFile(store, "files/change.txt", "new");
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
    await seedFile(store, "files/race.txt", "before");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.onObjectUpload = () => seedFile(store, "files/race.txt", "after");
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    expect(result.pending).toBe(1);
    expect(result.deleted).toBe(1);
    expect(cloud.objects.size).toBe(0);
    expect((await store.readIndex()).files["files/race.txt"].syncStatus).toBe(
      "pending",
    );
    await cleanup();
  });

  it("queues a second sync call behind an active sync", async () => {
    const store = await createStore();
    await seedFile(store, "files/queued.txt", "before");
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
        await seedFile(store, "files/queued.txt", "after");
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
    await seedFile(store, "files/offline.txt", "local");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    const service = new VaultSyncService(store, cloud, () => null);

    await expect(service.sync("token")).rejects.toThrow("VAULT_KEY_REQUIRED");
    expect(await readFile(store.filePath("files/offline.txt"), "utf8")).toBe(
      "local",
    );
    await cleanup();
  });

  it("keeps local files pending when the remote index request fails", async () => {
    const store = await createStore();
    await seedFile(store, "files/keep.txt", "depends");
    await store.writeIndex(await store.reconcile(await store.readIndex()));
    const cloud = new FakeCloudClient();
    cloud.failIndex = true;
    const service = new VaultSyncService(store, cloud, () => mek);

    const result = await service.sync("token");

    expect(result.pending).toBeGreaterThan(0);
    expect((await store.readIndex()).files["files/keep.txt"].syncStatus).toBe(
      "failed",
    );
    await cleanup();
  });

  describe("VaultResetService", () => {
    it("preserves local files while preparing a new remote backup", async () => {
      const store = await createStore();
      await seedFile(store, "files/keep.txt", "local");
      await seedFile(store, "files/notes.txt", "notes");
      await store.writeIndex({
        version: 2,
        files: {
          "files/keep.txt": {
            objectId: "old-1",
            hash: "h1",
            size: 5,
            mtime: 1,
            syncStatus: "synced",
            objectHash: "h1",
          },
          "files/notes.txt": {
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
      expect(await readFile(store.filePath("files/keep.txt"), "utf8")).toBe(
        "local",
      );
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
      expect((await store.readIndex()).files["files/keep.txt"].syncStatus).toBe(
        "pending",
      );
      await cleanup();
    });

    it("resumes an interrupted reset instead of treating its marker as permanent", async () => {
      const store = await createStore();
      await seedFile(store, "files/keep.txt", "local");
      await store.writeIndex({
        version: 2,
        files: {
          "files/keep.txt": {
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
      await seedFile(store, "files/keep.txt", "local");
      await store.writeIndex({
        version: 2,
        files: {
          "files/keep.txt": {
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
      expect(await readFile(store.filePath("files/keep.txt"), "utf8")).toBe(
        "local",
      );
      await cleanup();
    });

    it("does not persist a new MEK when the recovery code mismatches", async () => {
      const store = await createStore();
      await seedFile(store, "files/keep.txt", "local");
      await store.writeIndex({
        version: 2,
        files: {
          "files/keep.txt": {
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

    it("deletes every listed object on a keyless discard", async () => {
      const store = await createStore();
      const cloud = new FakeCloudClient();
      await cloud.putObject("token", "files-object", Buffer.from("f"));
      await cloud.putObject("token", "skills-object", Buffer.from("s"));
      const listSpy = vi.spyOn(cloud, "listObjectIds");
      const resetService = new VaultResetService(
        store,
        cloud,
        () => null,
        () => {},
      );

      await resetService.discardWithoutLocalKey("token");

      // 单槽现实：无 key 的丢弃列出整个账户的对象，调用不带 scope 过滤。
      expect(listSpy).toHaveBeenCalledWith("token");
      expect([...cloud.deletedObjectIds].sort()).toEqual([
        "files-object",
        "skills-object",
      ]);
      expect(cloud.objects.size).toBe(0);
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

  it("reads a changed file exactly once per sync run", async () => {
    const store = await createStore();
    await seedFile(store, "files/changed.md", "v1");
    const cloud = new FakeCloudClient();
    const sync = new VaultSyncService(store, cloud, () => mek);
    await sync.sync("token");

    await writeFile(store.filePath("files/changed.md"), "v2 changed");
    const { readFile: mockedReadFile } = await import("node:fs/promises");
    vi.mocked(mockedReadFile).mockClear();

    const result = await sync.sync("token");

    expect(result.uploaded).toBe(1);
    const contentReads = vi
      .mocked(mockedReadFile)
      .mock.calls.map(([target]) => String(target))
      .filter((target) => target.endsWith("changed.md"));
    expect(contentReads).toHaveLength(1);
    await cleanup();
  });

  it("skips the upload when the object is already indexed", async () => {
    const store = await createStore();
    await seedFile(store, "files/keep.md", "content");
    const cloud = new FakeCloudClient();
    const sync = new VaultSyncService(store, cloud, () => mek);
    await sync.sync("token");
    const before = await store.readIndex();
    const objectId = before.files["files/keep.md"].objectId;

    // 模拟「对象已传、本地索引已写、进程在写远端索引前崩溃」：内容与元数据未变，
    // 只有 syncStatus 退回 pending。
    before.files["files/keep.md"].syncStatus = "pending";
    await store.writeIndex(before);
    const objectsBefore = cloud.objects.size;
    const indexUploadsBefore = cloud.indexUploads;

    const result = await sync.sync("token");

    expect(result.uploaded).toBe(0);
    expect(cloud.objects.size).toBe(objectsBefore);
    expect(cloud.indexUploads).toBe(indexUploadsBefore + 1);
    const after = await store.readIndex();
    expect(after.files["files/keep.md"].syncStatus).toBe("synced");
    expect(after.files["files/keep.md"].objectId).toBe(objectId);
    await cleanup();
  });

  it("keeps the indexed object when the index upload still fails", async () => {
    const store = await createStore();
    await seedFile(store, "files/keep.md", "content");
    const cloud = new FakeCloudClient();
    const sync = new VaultSyncService(store, cloud, () => mek);
    await sync.sync("token");
    const before = await store.readIndex();
    const objectId = before.files["files/keep.md"].objectId;
    before.files["files/keep.md"].syncStatus = "pending";
    await store.writeIndex(before);
    const objectsBefore = cloud.objects.size;
    cloud.failIndex = true;

    await sync.sync("token");

    // 捷径条目本轮没有上传任何东西：索引写失败不该把它已传好的对象删掉或清空。
    expect(cloud.objects.size).toBe(objectsBefore);
    expect(cloud.deletedObjectIds).toEqual([]);
    const after = await store.readIndex();
    expect(after.files["files/keep.md"].objectId).toBe(objectId);
    expect(after.files["files/keep.md"].syncStatus).toBe("pending");
    await cleanup();
  });
});
