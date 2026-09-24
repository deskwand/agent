import { describe, expect, it, afterEach, vi } from "vitest";
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

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
      version: 2,
      files: {},
      pendingDeletes: [],
    });
  });

  it("exposes module roots under the vault root", async () => {
    const store = await createStore();

    expect(store.moduleRoot("files")).toBe(join(store.rootDir, "files"));
    expect(store.moduleRoot("skills")).toBe(join(store.rootDir, "skills"));
  });

  it("scans modules recursively and rejects unknown root entries", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await mkdir(join(root, "files", "项目"), { recursive: true });
    await mkdir(join(root, "skills", "demo"), { recursive: true });
    await writeFile(join(root, "files", "项目", "笔记.md"), "a");
    await writeFile(join(root, "skills", "demo", "SKILL.md"), "b");
    await writeFile(join(root, ".vault-index.json"), "{}");
    await writeFile(join(root, "vault-mek.bin"), "key");

    const names = (await store.scanFiles()).map((file) => file.name);
    expect(names).toEqual(
      expect.arrayContaining(["files/项目/笔记.md", "skills/demo/SKILL.md"]),
    );

    await writeFile(join(root, "stray.md"), "x");
    await expect(store.scanFiles()).rejects.toThrow(
      "VAULT_UNSUPPORTED_PATH:stray.md",
    );
  });

  it("scans hidden directories inside modules", async () => {
    const store = await createStore();
    await mkdir(join(store.rootDir, "files", ".cache"), { recursive: true });
    await writeFile(join(store.rootDir, "files", ".cache", "state.json"), "{}");

    const names = (await store.scanFiles()).map((file) => file.name);
    expect(names).toContain("files/.cache/state.json");
  });

  it("puts restore staging under the root .vault-staging directory", async () => {
    const store = await createStore();
    const transaction = await store.beginRestore(["files/a.md"]);

    expect(transaction.stagedDirectory).toContain(".vault-staging");

    await store.rollbackRestore(transaction);
  });

  it("never reads file contents while scanning or reconciling", async () => {
    const store = await createStore();
    await mkdir(join(store.rootDir, "files"), { recursive: true });
    await writeFile(join(store.rootDir, "files", "fresh.md"), "fresh");
    const { readFile: mockedReadFile } = await import("node:fs/promises");
    vi.mocked(mockedReadFile).mockClear();

    const reconciled = await store.reconcile(await store.readIndex());

    const contentReads = vi
      .mocked(mockedReadFile)
      .mock.calls.map(([target]) => String(target))
      .filter((target) => !target.endsWith(".vault-index.json"));
    expect(contentReads).toHaveLength(0);
    expect(reconciled.files["files/fresh.md"].hash).toBeNull();
  });

  it("never scans or targets internal root entries", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await mkdir(join(root, "files"), { recursive: true });
    await writeFile(join(root, "files", "keep.md"), "keep");
    await writeFile(join(root, ".vault-index.json"), "{}");
    await writeFile(join(root, "vault-mek.bin"), "encrypted key");
    await writeFile(join(root, ".vault-operation.json"), "{}");
    await mkdir(join(root, ".vault-staging", "tx"), { recursive: true });
    await writeFile(join(root, ".vault-staging", "tx", "a.md"), "half");

    expect((await store.scanFiles()).map((file) => file.name)).toEqual([
      "files/keep.md",
    ]);

    expect(() => store.filePath("vault-mek.bin")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath(".vault-index.json")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath(".vault-operation.json")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath(".vault-staging/a.md")).toThrow(
      "VAULT_INVALID_NAME",
    );
    // Win32 strips trailing dots/spaces, so a module-internal name that could
    // alias another file is rejected as well.
    expect(() => store.filePath("files/vault-mek.bin.")).toThrow(
      "VAULT_INVALID_NAME",
    );
  });

  it("copies one file into the files module and adds a suffix on collision", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    const source = join(tmpdir(), "deskwand-vault-source.txt");
    await writeFile(source, "source");
    roots.push(source);

    const first = await store.importFile(source);
    const second = await store.importFile(source);

    expect(first.name).toBe("files/deskwand-vault-source.txt");
    expect(second.name).toBe("files/deskwand-vault-source (1).txt");
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

  it("reconciles new, modified, and deleted local files", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await mkdir(join(root, "files"), { recursive: true });
    await writeFile(join(root, "files", "same.txt"), "old");
    await writeFile(join(root, "files", "deleted.txt"), "gone");
    const index = await store.reconcile({
      version: 2,
      files: {
        "files/same.txt": {
          objectId: "old-object",
          hash: "old-hash",
          size: 3,
          mtime: 1,
          syncStatus: "synced",
        },
        "files/deleted.txt": {
          objectId: "deleted-object",
          hash: "deleted-hash",
          size: 4,
          mtime: 1,
          syncStatus: "synced",
        },
      },
      pendingDeletes: [],
    });

    await writeFile(join(root, "files", "same.txt"), "new");
    await writeFile(join(root, "files", "new.txt"), "new file");
    await rm(join(root, "files", "deleted.txt"));
    const reconciled = await store.reconcile(index);

    expect(reconciled.files["files/same.txt"].objectId).toBe("old-object");
    expect(reconciled.files["files/same.txt"].syncStatus).toBe("pending");
    expect(reconciled.files["files/new.txt"].objectId).toBeNull();
    expect(reconciled.files["files/new.txt"].syncStatus).toBe("pending");
    expect(reconciled.files["files/deleted.txt"]).toBeUndefined();
    expect(reconciled.pendingDeletes).toEqual(["deleted-object"]);
  });

  it("recovers an interrupted staging restore on restart", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["files/a.txt"]);
    await store.stageRestoreFile(
      transaction,
      "files/a.txt",
      Buffer.from("restored"),
    );
    expect(existsSync(join(root, ".vault-operation.json"))).toBe(true);

    const restarted = new LocalVaultStore(store.rootDir);
    await restarted.ensureDirectory();
    await restarted.recoverPendingRestore();

    expect(existsSync(join(root, ".vault-operation.json"))).toBe(false);
    expect(existsSync(transaction.stagedDirectory)).toBe(false);
    expect(existsSync(join(root, "files", "a.txt"))).toBe(false);
  });

  it("keeps a fully committed restore after a crash before marker cleanup", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["files/a.txt"]);
    await store.stageRestoreFile(
      transaction,
      "files/a.txt",
      Buffer.from("restored"),
    );
    await store.writeOperationMarker({
      version: 1,
      id: transaction.id,
      kind: "restore",
      state: "committing",
      stagedDirectory: transaction.stagedDirectory,
      targetNames: transaction.targetNames,
    });
    await mkdir(join(root, "files"), { recursive: true });
    await rename(
      join(transaction.stagedDirectory, "files", "a.txt"),
      store.filePath("files/a.txt"),
    );
    await store.writeIndex({
      version: 2,
      files: {
        "files/a.txt": {
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

    expect(await readFile(store.filePath("files/a.txt"), "utf8")).toBe(
      "restored",
    );
    expect((await store.readIndex()).files["files/a.txt"]).toBeDefined();
    expect(await store.readOperationMarker()).toBeNull();
    // 只断言「文件还在」会空地通过：标记版本不合法时 readOperationMarker 会
    // 直接删掉它、recoverPendingRestore 根本不跑。暂存目录是否被清理才是恢复
    // 路径真的执行过的证据。
    expect(existsSync(transaction.stagedDirectory)).toBe(false);
  });

  it("cleans half-committed target files on restart", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    const transaction = await store.beginRestore(["files/a.txt"]);
    await store.stageRestoreFile(
      transaction,
      "files/a.txt",
      Buffer.from("restored"),
    );
    const marker = await store.readOperationMarker();
    await store.writeOperationMarker({
      ...marker!,
      state: "committing",
    });
    await mkdir(join(root, "files"), { recursive: true });
    await rename(
      join(transaction.stagedDirectory, "files", "a.txt"),
      store.filePath("files/a.txt"),
    );

    const restarted = new LocalVaultStore(store.rootDir);
    await restarted.ensureDirectory();
    await restarted.recoverPendingRestore();

    expect(existsSync(store.filePath("files/a.txt"))).toBe(false);
    expect(existsSync(transaction.stagedDirectory)).toBe(false);
    expect(await store.readOperationMarker()).toBeNull();
  });

  it("rejects names that escape the vault root or skip the module prefix", async () => {
    const store = await createStore();
    await store.ensureDirectory();

    expect(() => store.filePath("../outside.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("files/../../outside.md")).toThrow(
      "VAULT_INVALID_NAME",
    );
    expect(() => store.filePath("/abs/path.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("files//bar.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("files/")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("files\\bar.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("readme.md")).toThrow("VAULT_INVALID_NAME");
    expect(() => store.filePath("files")).toThrow("VAULT_INVALID_NAME");
  });

  it("rejects traversal keys when rereading the index", async () => {
    const store = await createStore();
    await store.ensureDirectory();
    await writeFile(
      store.indexPath,
      JSON.stringify({
        version: 2,
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
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    await mkdir(join(root, "files", "foo"), { recursive: true });
    await writeFile(join(root, "files", "foo", "SKILL.md"), "# foo");
    const index = await store.reconcile(await store.readIndex());
    index.files["files/foo/SKILL.md"].objectId = "remote-object";
    index.files["files/foo/SKILL.md"].syncStatus = "synced";
    await store.writeIndex(index);

    const reread = await store.readIndex();
    expect(reread.files["files/foo/SKILL.md"].objectId).toBe("remote-object");
    expect(reread.files["files/foo/SKILL.md"].syncStatus).toBe("synced");
  });

  it("scans trees recursively and skips symlinks", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await mkdir(join(root, "skills", "foo", "references"), { recursive: true });
    await writeFile(join(root, "skills", "foo", "SKILL.md"), "# foo");
    await writeFile(join(root, "skills", "foo", "references", "note.md"), "note");
    await symlink(
      join(root, "skills", "foo", "SKILL.md"),
      join(root, "skills", "foo", "link.md"),
    );

    const files = await store.scanFiles();

    // scanFiles 用 localeCompare 排序（顺序在 locale 间不稳定），这里只关心集合。
    expect(files.map((file) => file.name).sort()).toEqual([
      "skills/foo/SKILL.md",
      "skills/foo/references/note.md",
    ]);
    expect(files.find((file) => file.name === "skills/foo/SKILL.md")?.size).toBe(
      Buffer.byteLength("# foo"),
    );
  });

  it("skips symlinked files inside a module tree", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    await mkdir(join(root, "skills", "foo", "assets"), { recursive: true });
    await writeFile(join(root, "skills", "foo", "SKILL.md"), "# foo");
    await symlink(
      "missing-target",
      join(root, "skills", "foo", "assets", "gone.bin"),
    );

    const files = await store.scanFiles();

    expect(files.map((file) => file.name)).toEqual(["skills/foo/SKILL.md"]);
  });

  it("scans a single module file and returns null for directories", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await mkdir(join(root, "files", "sub"), { recursive: true });
    await writeFile(join(root, "files", "a.md"), "a");

    const file = await store.scanFile("files/a.md");
    expect(file?.hash).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
    await expect(store.scanFile("files/sub")).resolves.toBeNull();
    await expect(store.scanFile("readme.md")).rejects.toThrow(
      "VAULT_UNSUPPORTED_PATH:readme.md",
    );
  });

  it("refuses names that cannot sync instead of dropping them", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    await mkdir(join(root, "skills", "foo"), { recursive: true });
    await writeFile(join(root, "skills", "foo", "SKILL.md"), "# foo");
    // Win32 会把 "con.md" 当保留设备名、"notes." 归一化成 "notes"：这类名字
    // 一旦被扫描器静默跳过，reconcile 会把它判为已删除并删掉云端对象。
    await writeFile(join(root, "skills", "foo", "con.md"), "reserved");

    await expect(store.scanFiles()).rejects.toThrow(
      "VAULT_UNSUPPORTED_PATH:skills/foo/con.md",
    );
  });

  it("restores nested paths by creating parent directories", async () => {
    const store = await createStore();
    const root = store.rootDir;
    await store.ensureDirectory();
    const transaction = await store.beginRestore([
      "skills/foo/SKILL.md",
      "skills/foo/references/note.md",
    ]);
    await store.stageRestoreFile(
      transaction,
      "skills/foo/SKILL.md",
      Buffer.from("# foo"),
    );
    await store.stageRestoreFile(
      transaction,
      "skills/foo/references/note.md",
      Buffer.from("note"),
    );
    await store.commitRestore(transaction, {
      "skills/foo/SKILL.md": {
        objectId: "obj-skill",
        hash: "h1",
        size: 5,
        mtime: 1,
        syncStatus: "synced",
      },
      "skills/foo/references/note.md": {
        objectId: "obj-note",
        hash: "h2",
        size: 4,
        mtime: 1,
        syncStatus: "synced",
      },
    });

    await expect(
      readFile(join(root, "skills", "foo", "references", "note.md"), "utf8"),
    ).resolves.toBe("note");
    expect((await store.scanFiles()).map((file) => file.name).sort()).toEqual([
      "skills/foo/SKILL.md",
      "skills/foo/references/note.md",
    ]);
  });
});
