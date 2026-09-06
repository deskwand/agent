import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { encodeRemoteIndex } from "../src/main/vault/vault-index";
import { LocalVaultStore } from "../src/main/vault/local-store";
import {
  VaultRestoreService,
  VaultSyncService,
  type VaultCloudClient,
} from "../src/main/vault/sync";
import { packFile } from "../src/main/vault/objects";

const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const mek = deriveMek(code);

class FakeCloud implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  index: Buffer | null = null;
  failUploads = false;

  async putObject(_token: string, id: string, payload: Buffer): Promise<void> {
    if (this.failUploads) throw new Error("NETWORK_DOWN");
    this.objects.set(id, Buffer.from(payload));
  }

  async getObject(_token: string, id: string): Promise<Buffer> {
    const payload = this.objects.get(id);
    if (!payload) throw new Error("NOT_FOUND");
    return payload;
  }

  async deleteObject(_token: string, id: string): Promise<void> {
    this.objects.delete(id);
  }

  async getIndex(): Promise<Buffer | null> {
    return this.index;
  }

  async putIndex(_token: string, payload: Buffer): Promise<void> {
    this.index = Buffer.from(payload);
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
    await writeFile(restoredStore.filePath("document.md"), "keep-local");
    const restored = await new VaultRestoreService(
      restoredStore,
      cloud,
    ).restore("token", code);

    expect(restored).toEqual({ restored: 1, renamed: 1 });
    expect(
      await readFile(restoredStore.filePath("document (1).md"), "utf8"),
    ).toBe("remote");
  });
});
