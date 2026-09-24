import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { LocalVaultStore } from "../src/main/vault/local-store";
import { encodeRemoteIndex } from "../src/main/vault/vault-index";
import {
  VaultRestoreService,
  VaultSyncService,
  type VaultCloudClient,
} from "../src/main/vault/sync";

const code = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const mek = deriveMek(code);

class FakeCloud implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  index: Buffer | null = null;

  async putObject(
    _token: string,
    id: string,
    payload: Buffer,
  ): Promise<void> {
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

  async getIndex(_token: string): Promise<Buffer | null> {
    return this.index;
  }

  async putIndex(_token: string, payload: Buffer): Promise<void> {
    this.index = Buffer.from(payload);
  }

  async listObjectIds(_token: string): Promise<string[]> {
    return [...this.objects.keys()];
  }
}

/** 合成技能树：嵌套目录 + 中文名 + 二进制内容，不依赖真实技能。 */
const FIXTURE: Array<[string, Buffer]> = [
  ["foo/SKILL.md", Buffer.from("---\nname: foo\n---\n# foo\n")],
  ["foo/references/笔记.md", Buffer.from("参考 note\n")],
  ["foo/scripts/run.sh", Buffer.from("#!/bin/sh\necho hi\n")],
  ["foo/assets/blob.bin", Buffer.from([0, 1, 2, 255, 254, 128])],
];

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function seedTree(root: string): Promise<void> {
  for (const [name, contents] of FIXTURE) {
    const path = join(root, "skills", name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
}

describe("vault skills tree round trip", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function createRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    roots.push(root);
    return join(root, "vault-skills");
  }

  it("rejects case-colliding skills instead of renaming individual files", async () => {
    const target = new LocalVaultStore(
      await createRoot("vault-tree-conflict-"),
    );
    const cloud = new FakeCloud();
    cloud.index = encodeRemoteIndex(
      {
        version: 2,
        files: {
          "skills/foo/A.md": { objectId: "one", hash: "h1", size: 1, mtime: 1 },
          "skills/foo/a.md": { objectId: "two", hash: "h2", size: 1, mtime: 1 },
        },
      },
      mek,
    );
    await expect(
      new VaultRestoreService(target, cloud, () => mek).restoreWithLocalMek(
        "token",
      ),
    ).rejects.toThrow("VAULT_SKILL_NAME_CONFLICT");
    expect(await target.scanFiles()).toEqual([]);
  });

  it("syncs a nested tree and restores it byte for byte into another root", async () => {
    const source = new LocalVaultStore(await createRoot("vault-tree-a-"));
    await source.ensureDirectory();
    await seedTree(source.rootDir);

    const cloud = new FakeCloud();
    const sync = new VaultSyncService(source, cloud, () => mek);
    await source.writeIndex(await source.reconcile(await source.readIndex()));
    const result = await sync.sync("token");

    expect(result.failed).toBe(0);
    expect(result.uploaded).toBe(FIXTURE.length);

    const target = new LocalVaultStore(await createRoot("vault-tree-b-"));
    await target.ensureDirectory();
    const restore = new VaultRestoreService(target, cloud, () => mek);
    const restored = await restore.restoreWithLocalMek("token");

    expect(restored.restored).toBe(FIXTURE.length);
    for (const [name, contents] of FIXTURE) {
      const written = await readFile(join(target.rootDir, "skills", name));
      expect(sha256(written), name).toBe(sha256(contents));
    }
    expect((await target.scanFiles()).map((file) => file.name).sort()).toEqual(
      FIXTURE.map(([name]) => `skills/${name}`).sort(),
    );
  });

  it("treats a differently-cased directory as the same directory", async () => {
    const target = new LocalVaultStore(
      await createRoot("vault-tree-case-dir-"),
    );
    const cloud = new FakeCloud();
    cloud.index = encodeRemoteIndex(
      {
        version: 2,
        files: {
          "skills/Foo/x.md": { objectId: "one", hash: "h1", size: 1, mtime: 1 },
          "skills/foo/y.md": { objectId: "two", hash: "h2", size: 1, mtime: 1 },
        },
      },
      mek,
    );

    await expect(
      new VaultRestoreService(target, cloud, () => mek).restoreWithLocalMek(
        "token",
      ),
    ).rejects.toThrow("VAULT_SKILL_NAME_CONFLICT");
  });

  it("keeps sibling files under one skill tree", async () => {
    const source = new LocalVaultStore(await createRoot("vault-tree-siblings-a-"));
    await source.ensureDirectory();
    await mkdir(join(source.rootDir, "skills", "foo"), { recursive: true });
    await writeFile(join(source.rootDir, "skills", "foo", "A.md"), "a");
    await writeFile(join(source.rootDir, "skills", "foo", "b.md"), "b");

    const cloud = new FakeCloud();
    await source.writeIndex(await source.reconcile(await source.readIndex()));
    await new VaultSyncService(source, cloud, () => mek).sync("token");

    const target = new LocalVaultStore(await createRoot("vault-tree-siblings-b-"));
    const restored = await new VaultRestoreService(
      target,
      cloud,
      () => mek,
    ).restoreWithLocalMek("token");

    expect(restored.restored).toBe(2);
  });
});
