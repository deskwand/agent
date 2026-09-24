import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deriveMek } from "../src/main/vault/crypto";
import { VaultSkillsStore } from "../src/main/vault/skills-vault";
import type {
  VaultCloudClient,
  VaultIndexScope,
} from "../src/main/vault/cloud-client";

const MEK = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** 按 scope 分桶的云替身：一次上传两个 scope 的隔离性靠它验证。 */
class FakeScopedCloud implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  readonly indexes = new Map<VaultIndexScope, Buffer>();

  async putObject(
    _token: string,
    scope: VaultIndexScope,
    id: string,
    payload: Buffer,
  ): Promise<void> {
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
    scope: VaultIndexScope,
  ): Promise<Buffer | null> {
    return this.indexes.get(scope) ?? null;
  }

  async putIndex(
    _token: string,
    scope: VaultIndexScope,
    payload: Buffer,
  ): Promise<void> {
    this.indexes.set(scope, Buffer.from(payload));
  }

  /** 按 scope 分桶 —— 之前的版本忽略 scope，会让隔离断言假通过。 */
  readonly objectsByScope = new Map<VaultIndexScope, Map<string, Buffer>>();

  async listObjectIds(
    _token: string,
    scope: VaultIndexScope,
  ): Promise<string[]> {
    return [...(this.objectsByScope.get(scope)?.keys() ?? [])];
  }
}

describe("VaultSkillsStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function createVault(
    cloud: VaultCloudClient = new FakeScopedCloud(),
  ): Promise<VaultSkillsStore> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-skills-"));
    roots.push(root);
    return new VaultSkillsStore(join(root, "vault-skills"), cloud, () => MEK);
  }

  it("starts empty and lists nothing", async () => {
    const vault = await createVault();

    await expect(vault.listVaultSkills()).resolves.toEqual([]);
  });

  it("lists one entry per skill directory with file counts", async () => {
    const vault = await createVault();
    await mkdir(join(vault.store.rootDir, "foo", "references"), {
      recursive: true,
    });
    await writeFile(join(vault.store.rootDir, "foo", "SKILL.md"), "# foo");
    await writeFile(
      join(vault.store.rootDir, "foo", "references", "note.md"),
      "note",
    );

    const entries = await vault.listVaultSkills();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "foo", fileCount: 2 });
    expect(entries[0].totalBytes).toBeGreaterThan(0);
  });

  it("uses the skills scope for every store operation", async () => {
    const vault = await createVault();

    expect(vault.store.scope).toBe("skills");
  });

  it("clears a stale staging directory", async () => {
    const vault = await createVault();
    await mkdir(join(vault.store.rootDir, ".vault-upload-staging", "foo"), {
      recursive: true,
    });
    await writeFile(
      join(vault.store.rootDir, ".vault-upload-staging", "foo", "SKILL.md"),
      "# half-copied",
    );

    await vault.removeStaleStaging();

    await expect(
      stat(join(vault.store.rootDir, ".vault-upload-staging")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  async function createGlobalSkills(
    tree: Array<[string, Buffer]>,
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-global-skills-"));
    roots.push(root);
    const globalSkills = join(root, "skills");
    for (const [name, contents] of tree) {
      const path = join(globalSkills, name);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, contents);
    }
    return globalSkills;
  }

  it("moves a skill whose file exceeds the old import limit", async () => {
    // 20 MiB 只是「手动导入文件」的护栏；技能路径不按体积拦截。
    const globalSkills = await createGlobalSkills([
      ["big/SKILL.md", Buffer.from("# big")],
      ["big/model.bin", Buffer.alloc(21 * 1024 * 1024)],
    ]);
    const vault = await createVault();

    await expect(vault.upload("big", globalSkills)).resolves.toMatchObject({
      name: "big",
      fileCount: 2,
    });
  });

  it("reports symlinked entries and keeps them out of the index", async () => {
    const globalSkills = await createGlobalSkills([
      ["linked/SKILL.md", Buffer.from("# linked")],
    ]);
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    const vault = await createVault();

    await expect(
      vault.findSymlinkedEntries("linked", globalSkills),
    ).resolves.toEqual(["dangling"]);

    await vault.upload("linked", globalSkills);
    const index = await vault.store.readIndex();
    // 符号链接的内容不会被加密同步：扫描器必须跳过它
    expect(Object.keys(index.files)).toEqual(["linked/SKILL.md"]);
  });

  it("moves a skill into the vault and removes the local copy", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
      ["foo/references/note.md", Buffer.from("note")],
    ]);
    const vault = await createVault();

    const entry = await vault.upload("foo", globalSkills);

    expect(entry).toMatchObject({ name: "foo", fileCount: 2 });
    await expect(stat(join(globalSkills, "foo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(vault.store.rootDir, "foo", "references", "note.md")),
    ).resolves.toBeTruthy();
  });

  it("does not touch the local copy when the vault already has the skill", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const vault = await createVault();
    await vault.upload("foo", globalSkills);
    // 重新造一份同名本地技能（模拟用户再次上传）
    await mkdir(join(globalSkills, "foo"), { recursive: true });
    await writeFile(join(globalSkills, "foo", "SKILL.md"), "# foo again");

    await expect(vault.upload("foo", globalSkills)).rejects.toThrow(
      "VAULT_SKILL_NAME_TAKEN",
    );
    await expect(
      stat(join(globalSkills, "foo", "SKILL.md")),
    ).resolves.toBeTruthy();
  });

  it("removes a synced skill from the vault", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const vault = await createVault();
    await vault.upload("foo", globalSkills);
    // 删除要求已同步：先真的同步一次（否则本机只剩密库这一份，云端还没有副本）
    await vault.syncService.sync("token");

    await vault.remove("foo");

    await expect(vault.listVaultSkills()).resolves.toEqual([]);
    await expect(stat(join(vault.store.rootDir, "foo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores an uploaded skill byte for byte on another device", async () => {
    const tree: Array<[string, Buffer]> = [
      ["foo/SKILL.md", Buffer.from("---\nname: foo\n---\n# foo\n")],
      ["foo/references/笔记.md", Buffer.from("参考 note\n")],
      ["foo/scripts/run.sh", Buffer.from("#!/bin/sh\necho hi\n")],
      ["foo/assets/blob.bin", Buffer.from([0, 1, 2, 255, 254, 128])],
    ];
    const globalSkills = await createGlobalSkills(tree);
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-roundtrip-"));
    roots.push(root);
    const mek = MEK;
    const cloud = new FakeScopedCloud();

    const source = new VaultSkillsStore(
      join(root, "vault-skills-a"),
      cloud,
      () => mek,
    );
    await source.upload("foo", globalSkills);
    await source.syncService.sync("token");

    const target = new VaultSkillsStore(
      join(root, "vault-skills-b"),
      cloud,
      () => mek,
    );
    await target.store.ensureDirectory();
    const restored = await target.restoreService.restoreWithLocalMek("token");

    expect(restored.restored).toBe(tree.length);
    for (const [name, contents] of tree) {
      const written = await readFile(join(target.store.rootDir, name));
      expect(sha256(written), name).toBe(sha256(contents));
    }
    expect((await target.listVaultSkills())[0]).toMatchObject({
      name: "foo",
      fileCount: 4,
    });
  });

  it("only offers candidates whose names the upload path accepts", async () => {
    const globalSkills = await createGlobalSkills([
      ["good-name/SKILL.md", Buffer.from("# good")],
      ["Bad_Name/SKILL.md", Buffer.from("# bad")],
      ["with.dot/SKILL.md", Buffer.from("# dot")],
    ]);
    const vault = await createVault();

    const candidates = await vault.listUploadCandidates(globalSkills);

    expect(candidates).toEqual([{ name: "good-name", description: "" }]);
    // 每个候选都必须能真正上传成功（名字规则一致）
    for (const candidate of candidates) {
      await expect(
        vault.upload(candidate.name, globalSkills),
      ).resolves.toMatchObject({ name: candidate.name });
    }
  });

  it("refuses to delete a vault skill that is not synced yet", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const vault = await createVault();
    await vault.upload("foo", globalSkills);
    // 上传后条目标记 pending（尚未同步到云端）

    await expect(vault.remove("foo")).rejects.toThrow("VAULT_SKILL_NOT_SYNCED");
    await expect(vault.listVaultSkills()).resolves.toHaveLength(1);
  });

  it("moves a skill with rename so the source directory is gone", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const vault = await createVault();

    await vault.upload("foo", globalSkills);

    await expect(stat(join(globalSkills, "foo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(vault.store.rootDir, "foo", "SKILL.md")),
    ).resolves.toBeTruthy();
  });

  it("lists candidates with best-effort descriptions", async () => {
    const globalSkills = await createGlobalSkills([
      [
        "with-desc/SKILL.md",
        Buffer.from("---\nname: with-desc\ndescription: 有描述\n---\n# x\n"),
      ],
      // 没有 description：必须仍然列出（今天只要求 SKILL.md 存在）
      ["no-desc/SKILL.md", Buffer.from("# x\n")],
    ]);
    const vault = await createVault();

    const candidates = await vault.listUploadCandidates(globalSkills);

    expect(candidates).toEqual([
      { name: "no-desc", description: "" },
      { name: "with-desc", description: "有描述" },
    ]);
  });

  it("returns nothing for a name outside the vault layout", async () => {
    const globalSkills = await createGlobalSkills([
      ["ok/SKILL.md", Buffer.from("# ok")],
    ]);
    const vault = await createVault();

    // 守卫生效时不该去读技能目录之外的东西
    await expect(
      vault.findSymlinkedEntries("../..", globalSkills),
    ).resolves.toEqual([]);
  });

  it("reports symlinked entries of a skill", async () => {
    const globalSkills = await createGlobalSkills([
      ["linked/SKILL.md", Buffer.from("# linked")],
    ]);
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    const vault = await createVault();

    await expect(
      vault.findSymlinkedEntries("linked", globalSkills),
    ).resolves.toEqual(["dangling"]);
  });

  it("asks for confirmation when a selected skill contains symlinks", async () => {
    const globalSkills = await createGlobalSkills([
      ["plain/SKILL.md", Buffer.from("# plain")],
      ["linked/SKILL.md", Buffer.from("# linked")],
    ]);
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    const vault = await createVault();

    const result = await vault.addSkills(["plain", "linked"], globalSkills);

    expect(result.needsConfirmation).toEqual([
      { name: "linked", symlinkedEntries: ["dangling"] },
    ]);
    expect(result.added).toEqual([]);
    // 未确认时磁盘不动
    await expect(stat(join(globalSkills, "plain"))).resolves.toBeTruthy();
    await expect(stat(join(globalSkills, "linked"))).resolves.toBeTruthy();
  });

  it("moves every selected skill once the links are confirmed", async () => {
    const globalSkills = await createGlobalSkills([
      ["plain/SKILL.md", Buffer.from("# plain")],
      ["linked/SKILL.md", Buffer.from("# linked")],
    ]);
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    const vault = await createVault();

    const result = await vault.addSkills(
      ["plain", "linked"],
      globalSkills,
      true,
    );

    expect(result.needsConfirmation).toBeUndefined();
    // added 按输入顺序累积（界面传的是勾选顺序）
    expect(result.added).toEqual(["plain", "linked"]);
    expect(result.failed).toEqual([]);
  });

  it("keeps going when one skill fails to move", async () => {
    const globalSkills = await createGlobalSkills([
      ["already/SKILL.md", Buffer.from("# already")],
      ["fresh/SKILL.md", Buffer.from("# fresh")],
    ]);
    const vault = await createVault();
    // 密库里先放一个同名技能 → 该技能必然失败
    await mkdir(join(vault.store.rootDir, "already"), { recursive: true });
    await writeFile(
      join(vault.store.rootDir, "already", "SKILL.md"),
      "# existing",
    );

    const result = await vault.addSkills(
      ["already", "fresh"],
      globalSkills,
      true,
    );

    expect(result.added).toEqual(["fresh"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("already");
    expect(result.failed[0].reason).toContain("VAULT_SKILL_NAME_TAKEN");
    // 失败者的本地原件必须还在
    await expect(stat(join(globalSkills, "already"))).resolves.toBeTruthy();
  });

  it("keeps reporting the moved skills when the index write fails", async () => {
    const globalSkills = await createGlobalSkills([
      ["golden/SKILL.md", Buffer.from("# golden")],
    ]);
    const vault = await createVault();
    const spy = vi
      .spyOn(vault.store, "writeIndex")
      .mockRejectedValueOnce(new Error("VAULT_UNSUPPORTED_PATH:golden/bad."));

    const result = await vault.addSkills(["golden"], globalSkills, true);

    // 文件已经搬进密库：不能报成整批失败，但要把索引错误带出来
    expect(result.added).toEqual(["golden"]);
    expect(result.failed).toEqual([]);
    expect(result.indexError).toContain("VAULT_UNSUPPORTED_PATH");
    await expect(stat(join(vault.store.rootDir, "golden"))).resolves.toBeTruthy();
    spy.mockRestore();
  });

  it("rejects names that are not skill directories before scanning", async () => {
    const globalSkills = await createGlobalSkills([
      ["ok/SKILL.md", Buffer.from("# ok")],
    ]);
    const vault = await createVault();

    const result = await vault.addSkills(
      ["../escape", "ok"],
      globalSkills,
      true,
    );

    expect(result.added).toEqual(["ok"]);
    expect(result.failed).toEqual([
      { name: "../escape", reason: "VAULT_INVALID_SKILL_NAME:../escape" },
    ]);
  });
});
