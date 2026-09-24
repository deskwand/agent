import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
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

  async function createSkillStore(): Promise<LocalVaultStore> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-skills-"));
    roots.push(root);
    return new LocalVaultStore(join(root, "vault-skills"), "skills");
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

  it("imports past the old 100 MiB local ceiling", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const source = join(tmpdir(), "vault-past-ceiling.bin");
    await writeFile(source, "");
    await truncate(source, 20 * 1024 * 1024);
    roots.push(source);

    for (let index = 0; index < 6; index += 1) {
      await expect(store.importFile(source)).resolves.toBeDefined();
    }

    await expect(store.getUsageBytes()).resolves.toBe(6 * 20 * 1024 * 1024);
    await expect(store.scanFiles()).resolves.toHaveLength(6);
  });

  it("reports zero usage after deleting a file", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const source = join(tmpdir(), "vault-release.bin");
    await writeFile(source, "");
    await truncate(source, 10);
    roots.push(source);
    const imported = await store.importFile(source);

    await store.deleteFile(imported.name);

    await expect(store.getUsageBytes()).resolves.toBe(0);
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

  it("never scans or targets internal Vault files", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    await writeFile(join(store.rootDir, "vault-mek.bin"), "encrypted key");
    await writeFile(join(store.rootDir, ".vault-index.json.tmp-stale"), "{}");
    await writeFile(
      join(store.rootDir, ".vault-operation.json.tmp-stale"),
      "{}",
    );
    expect((await store.scanFiles()).map((file) => file.name)).not.toContain(
      "vault-mek.bin",
    );
    expect((await store.scanFiles()).map((file) => file.name)).not.toContain(
      ".vault-operation.json.tmp-stale",
    );
    expect(() => store.filePath("vault-mek.bin")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("Vault-MEK.BIN")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath(".VAULT-INDEX.JSON.tmp")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath(".VAULT-OPERATION.JSON.tmp")).toThrow(
      "VAULT_INVALID_NAME",
    );
    // Win32 resolves these to the reserved files (trailing dots/spaces are
    // stripped), so they must be rejected as well.
    expect(() => store.filePath("vault-mek.bin.")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath("vault-mek.bin ")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath(".vault-restore.")).toThrow(
      "VAULT_INVALID_NAME",
    );
  });

  it("removes a legacy internal key entry without deleting the key file", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const keyPath = join(store.rootDir, "vault-mek.bin");
    await writeFile(keyPath, "encrypted key");
    await store.writeIndex({
      version: 1,
      files: {
        "vault-mek.bin": {
          objectId: "legacy-object",
          hash: "hash",
          size: 12,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });

    const reconciled = await store.reconcile(await store.readIndex());
    expect(reconciled.files["vault-mek.bin"]).toBeUndefined();
    expect(reconciled.pendingDeletes).toEqual(["legacy-object"]);
    await expect(readFile(keyPath, "utf8")).resolves.toBeTruthy();
  });

  it("recovers an interrupted staging restore on restart", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["a.txt"]);
    await store.stageRestoreFile(transaction, "a.txt", Buffer.from("restored"));
    expect(existsSync(join(store.rootDir, ".vault-operation.json"))).toBe(true);

    const restarted = new LocalVaultStore(store.rootDir);
    await restarted.ensureDirectory();
    await restarted.recoverPendingRestore();

    expect(existsSync(join(store.rootDir, ".vault-operation.json"))).toBe(
      false,
    );
    expect(existsSync(transaction.stagedDirectory)).toBe(false);
    expect(existsSync(join(store.rootDir, "a.txt"))).toBe(false);
  });

  it("keeps a fully committed restore after a crash before marker cleanup", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["a.txt"]);
    await store.stageRestoreFile(transaction, "a.txt", Buffer.from("restored"));
    await store.writeOperationMarker({
      version: 1,
      id: transaction.id,
      kind: "restore",
      state: "committing",
      stagedDirectory: transaction.stagedDirectory,
      targetNames: transaction.targetNames,
    });
    await rename(
      join(transaction.stagedDirectory, "a.txt"),
      store.filePath("a.txt"),
    );
    await store.writeIndex({
      version: 1,
      files: {
        "a.txt": {
          objectId: "remote-a",
          hash: "hash",
          size: 8,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });

    const restarted = new LocalVaultStore(store.rootDir);
    await restarted.recoverPendingRestore();

    expect(await readFile(store.filePath("a.txt"), "utf8")).toBe("restored");
    expect((await store.readIndex()).files["a.txt"]).toBeDefined();
    expect(await store.readOperationMarker()).toBeNull();
  });

  it("cleans half-committed target files on restart", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["a.txt"]);
    await store.stageRestoreFile(transaction, "a.txt", Buffer.from("restored"));
    const marker = await store.readOperationMarker();
    await store.writeOperationMarker({
      ...marker!,
      state: "committing",
    });
    await rename(
      join(transaction.stagedDirectory, "a.txt"),
      store.filePath("a.txt"),
    );

    const restarted = new LocalVaultStore(store.rootDir);
    await restarted.ensureDirectory();
    await restarted.recoverPendingRestore();

    expect(existsSync(store.filePath("a.txt"))).toBe(false);
    expect(existsSync(transaction.stagedDirectory)).toBe(false);
    expect(await store.readOperationMarker()).toBeNull();
  });

  it("rejects names that escape the vault root", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();

    expect(() => store.filePath("../outside.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("foo/../../outside.md")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath("/abs/path.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("foo//bar.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("foo/")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("foo\\bar.md")).toThrow("VAULT_INVALID_NAME");
  });

  it("still rejects reserved names at the root of a skills store", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();

    expect(() => store.filePath(".vault-index.json")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath("vault-mek.bin.")).toThrow(
      "VAULT_INVALID_NAME",
    );
  });

  it("rejects traversal keys when rereading a skills index", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await writeFile(
      store.indexPath,
      JSON.stringify({
        version: 1,
        files: {
          "../escape.md": {
            objectId: "obj-escape",
            hash: "h",
            size: 1,
            mtime: 1,
            syncStatus: "synced",
          },
        },
        pendingDeletes: [],
      }),
    );

    expect((await store.readIndex()).files).toEqual({});
  });

  it("rereads nested index entries without rebuilding", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await mkdir(join(store.rootDir, "foo"));
    await writeFile(join(store.rootDir, "foo", "SKILL.md"), "# foo");
    const index = await store.reconcile(await store.readIndex());
    index.files["foo/SKILL.md"].objectId = "remote-object";
    index.files["foo/SKILL.md"].syncStatus = "synced";
    await store.writeIndex(index);

    const reread = await store.readIndex();
    expect(reread.files["foo/SKILL.md"].objectId).toBe("remote-object");
    expect(reread.files["foo/SKILL.md"].syncStatus).toBe("synced");
  });

  it("scans nested skill trees recursively and skips symlinks and reserved names", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await mkdir(join(store.rootDir, "foo", "references"), { recursive: true });
    await writeFile(join(store.rootDir, "foo", "SKILL.md"), "# foo");
    await writeFile(
      join(store.rootDir, "foo", "references", "note.md"),
      "note",
    );
    await symlink(
      join(store.rootDir, "foo", "SKILL.md"),
      join(store.rootDir, "foo", "link.md"),
    );

    const files = await store.scanFiles();

    // scanFiles 用 localeCompare 排序（顺序在 locale 间不稳定），这里只关心集合。
    expect(files.map((file) => file.name).sort()).toEqual([
      "foo/SKILL.md",
      "foo/references/note.md",
    ]);
    expect(files.find((file) => file.name === "foo/SKILL.md")?.size).toBe(
      Buffer.byteLength("# foo"),
    );
  });

  it("restores nested paths by creating parent directories", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    const transaction = await store.beginRestore([
      "foo/SKILL.md",
      "foo/references/note.md",
    ]);
    await store.stageRestoreFile(
      transaction,
      "foo/SKILL.md",
      Buffer.from("# foo"),
    );
    await store.stageRestoreFile(
      transaction,
      "foo/references/note.md",
      Buffer.from("note"),
    );
    await store.commitRestore(transaction, {
      "foo/SKILL.md": {
        objectId: "obj-skill",
        hash: "h1",
        size: 5,
        mtime: 1,
        syncStatus: "synced",
      },
      "foo/references/note.md": {
        objectId: "obj-note",
        hash: "h2",
        size: 4,
        mtime: 1,
        syncStatus: "synced",
      },
    });

    await expect(
      readFile(join(store.rootDir, "foo", "references", "note.md"), "utf8"),
    ).resolves.toBe("note");
    expect((await store.scanFiles()).map((file) => file.name).sort()).toEqual([
      "foo/SKILL.md",
      "foo/references/note.md",
    ]);
  });

  it("rejects scanFile outside the skills scope", async () => {
    const store = await createStore();
    await store.ensureDirectory();

    await expect(store.scanFile("a.md")).rejects.toThrow("VAULT_INVALID_SCOPE");
  });

  it("skips symlinked files inside a skill tree", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await mkdir(join(store.rootDir, "foo", "assets"), { recursive: true });
    await writeFile(join(store.rootDir, "foo", "SKILL.md"), "# foo");
    await symlink(
      "missing-target",
      join(store.rootDir, "foo", "assets", "gone.bin"),
    );

    const files = await store.scanFiles();

    expect(files.map((file) => file.name)).toEqual(["foo/SKILL.md"]);
  });

  it("refuses names that cannot sync instead of dropping them", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await mkdir(join(store.rootDir, "foo"), { recursive: true });
    await writeFile(join(store.rootDir, "foo", "SKILL.md"), "# foo");
    // Win32 会把 "con.md" 当保留设备名、"notes." 归一化成 "notes"：这类名字
    // 一旦被扫描器静默跳过，reconcile 会把它判为已删除并删掉云端对象。
    await writeFile(join(store.rootDir, "foo", "con.md"), "reserved");

    await expect(store.scanFiles()).rejects.toThrow(
      "VAULT_UNSUPPORTED_PATH:foo/con.md",
    );
  });

  it("skips hidden directories at the root of a skills tree", async () => {
    const store = await createSkillStore();
    await store.ensureDirectory();
    await mkdir(join(store.rootDir, "foo"), { recursive: true });
    await writeFile(join(store.rootDir, "foo", "SKILL.md"), "# foo");
    await mkdir(join(store.rootDir, ".vault-upload-staging", "bar"), {
      recursive: true,
    });
    await writeFile(
      join(store.rootDir, ".vault-upload-staging", "bar", "SKILL.md"),
      "# half-copied",
    );

    const files = await store.scanFiles();

    expect(files.map((file) => file.name)).toEqual(["foo/SKILL.md"]);
  });
});
