import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalVaultStore } from "../src/main/vault/local-store";

describe("LocalVaultStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function createStore(): Promise<LocalVaultStore> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-store-"));
    roots.push(root);
    return new LocalVaultStore(join(root, "vault"));
  }

  it("creates the directory and distinguishes a missing index", async () => {
    const store = await createStore();

    await store.ensureDirectory();

    expect(await store.hasIndex()).toBe(false);
    expect(await store.readIndex()).toEqual({
      version: 1,
      files: {},
      pendingDeletes: [],
    });
  });

  it("scans regular files and excludes the local index", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    await writeFile(join(store.rootDir, ".vault-index.json"), "{}");
    await writeFile(join(store.rootDir, ".vault-index.json.tmp-stale"), "{}");
    await writeFile(join(store.rootDir, ".vault-index.json.corrupt-old"), "{}");
    await writeFile(join(store.rootDir, "vault-mek.bin"), "internal key");
    await writeFile(join(store.rootDir, "readme.md"), "hello");
    await writeFile(join(store.rootDir, ".hidden.txt"), "hidden");

    const files = await store.scanFiles();

    expect(files.map((file) => file.name)).toEqual([
      ".hidden.txt",
      "readme.md",
    ]);
    expect(files.find((file) => file.name === "readme.md")?.hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("copies one file into the Vault and adds a suffix on collision", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const source = join(tmpdir(), "deskwand-vault-source.txt");
    await writeFile(source, "source");
    roots.push(source);

    const first = await store.importFile(source);
    const second = await store.importFile(source);

    expect(first.name).toBe("deskwand-vault-source.txt");
    expect(second.name).toBe("deskwand-vault-source (1).txt");
    expect(await readFile(store.filePath(first.name), "utf8")).toBe("source");
    expect(await readFile(source, "utf8")).toBe("source");
  });

  it("rejects files larger than 20 MB before copying", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const source = join(tmpdir(), "deskwand-vault-large.bin");
    await writeFile(source, Buffer.alloc(20 * 1024 * 1024 + 1));
    roots.push(source);

    await expect(store.importFile(source)).rejects.toThrow(
      "VAULT_FILE_TOO_LARGE",
    );
    expect(await store.scanFiles()).toEqual([]);
  });

  it("reconciles a leaked internal key entry without deleting the key file", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const keyPath = join(store.rootDir, "vault-mek.bin");
    await writeFile(keyPath, "encrypted key");

    const reconciled = await store.reconcile({
      version: 1,
      files: {
        "vault-mek.bin": {
          objectId: "leaked-object",
          hash: "hash",
          size: 12,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });

    expect(reconciled.files["vault-mek.bin"]).toBeUndefined();
    expect(reconciled.pendingDeletes).toEqual(["leaked-object"]);
    expect(await readFile(keyPath, "utf8")).toBe("encrypted key");
  });

  it("reconciles new, modified, and deleted local files", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    await writeFile(join(store.rootDir, "same.txt"), "old");
    await writeFile(join(store.rootDir, "deleted.txt"), "gone");
    const index = await store.reconcile({
      version: 1,
      files: {
        "same.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
        "deleted.txt": {
          objectId: "deleted-object",
          hash: "deleted-hash",
          size: 4,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });

    await writeFile(join(store.rootDir, "same.txt"), "new");
    await writeFile(join(store.rootDir, "new.txt"), "new file");
    await rm(join(store.rootDir, "deleted.txt"));
    const reconciled = await store.reconcile(index);

    expect(reconciled.files["same.txt"].objectId).toBe("old-object");
    expect(reconciled.files["same.txt"].syncStatus).toBe("pending");
    expect(reconciled.files["new.txt"].objectId).toBeNull();
    expect(reconciled.files["new.txt"].syncStatus).toBe("pending");
    expect(reconciled.files["deleted.txt"]).toBeUndefined();
    expect(reconciled.pendingDeletes).toEqual(["deleted-object"]);
  });
});
