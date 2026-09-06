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
  VaultSyncService,
  type VaultCloudClient,
} from "../src/main/vault/sync";

const mek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

class FakeCloudClient implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  indexPayload: Buffer | null = null;
  failObjectUpload = false;
  failObjectDelete = false;
  failIndex = false;
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
  }

  async getIndex(_token: string): Promise<Buffer | null> {
    return this.indexPayload;
  }

  async putIndex(_token: string, payload: Buffer): Promise<void> {
    if (this.failIndex) throw new Error("NETWORK_DOWN");
    this.indexPayload = Buffer.from(payload);
    this.indexUploads += 1;
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
});
