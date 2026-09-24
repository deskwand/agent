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
import { LocalVaultStore } from "../src/main/vault/local-store";
import { VaultSkillsStore } from "../src/main/vault/skills-vault";
import { VaultRestoreService, VaultSyncService } from "../src/main/vault/sync";
import type { VaultCloudClient } from "../src/main/vault/cloud-client";

const MEK = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** 单槽云替身：上传 → 同步 → 另一台设备恢复的往返全靠它。 */
class FakeCloud implements VaultCloudClient {
  readonly objects = new Map<string, Buffer>();
  index: Buffer | null = null;

  async putObject(_token: string, id: string, payload: Buffer): Promise<void> {
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

describe("VaultSkillsStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  /**
   * 技能聚合视图与整个密库共用一个 store；同步/恢复服务挂在共享 store 上，
   * 不再是 VaultSkillsStore 的成员。
   */
  async function createVault(
    cloud: VaultCloudClient = new FakeCloud(),
  ): Promise<{
    vault: VaultSkillsStore;
    store: LocalVaultStore;
    sync: () => Promise<unknown>;
    restore: () => Promise<{ restored: number; renamed: number }>;
  }> {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-skills-"));
    roots.push(root);
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    return {
      vault: new VaultSkillsStore(store),
      store,
      sync: () => new VaultSyncService(store, cloud, () => MEK).sync("token"),
      restore: () =>
        new VaultRestoreService(store, cloud, () => MEK).restoreWithLocalMek(
          "token",
        ),
    };
  }

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

  it("starts empty and lists nothing", async () => {
    const { vault } = await createVault();

    await expect(vault.listVaultSkills()).resolves.toEqual([]);
  });

  it("surfaces a file sitting directly under the skills module", async () => {
    const { vault } = await createVault();
    const skillsRoot = vault.store.moduleRoot("skills");
    await mkdir(skillsRoot, { recursive: true });
    await writeFile(join(skillsRoot, "notes.md"), "note");

    // 设计上不允许「同步了但看不见」的内容：直接放在 skills/ 下的文件也得
    // 出现在技能列表里（哪怕它不是一个正经的技能目录）。
    await expect(vault.listVaultSkills()).resolves.toEqual([
      { name: "notes.md", fileCount: 1, totalBytes: 4, syncStatus: "pending" },
    ]);
  });

  it("lists one entry per skill directory with file counts", async () => {
    const { vault } = await createVault();
    const skillsRoot = vault.store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "foo", "references"), {
      recursive: true,
    });
    await writeFile(join(skillsRoot, "foo", "SKILL.md"), "# foo");
    await writeFile(join(skillsRoot, "foo", "references", "note.md"), "note");

    const entries = await vault.listVaultSkills();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "foo", fileCount: 2 });
    expect(entries[0].totalBytes).toBeGreaterThan(0);
  });

  it("stores every skill under the skills module", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const { vault } = await createVault();

    await vault.upload("foo", globalSkills);

    const index = await vault.store.readIndex();
    expect(Object.keys(index.files)).toEqual(["skills/foo/SKILL.md"]);
    await expect(
      stat(join(vault.store.moduleRoot("skills"), "foo", "SKILL.md")),
    ).resolves.toBeTruthy();
  });

  it("clears a stale staging directory", async () => {
    const { vault } = await createVault();
    const staging = join(vault.store.rootDir, ".vault-staging", "upload");
    await mkdir(join(staging, "foo"), { recursive: true });
    await writeFile(join(staging, "foo", "SKILL.md"), "# half-copied");

    await vault.removeStaleStaging();

    await expect(stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("moves a skill whose file exceeds the old import limit", async () => {
    // 20 MiB 只是「手动导入文件」的护栏；技能路径不按体积拦截。
    const globalSkills = await createGlobalSkills([
      ["big/SKILL.md", Buffer.from("# big")],
      ["big/model.bin", Buffer.alloc(21 * 1024 * 1024)],
    ]);
    const { vault } = await createVault();

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
    const { vault } = await createVault();

    await expect(
      vault.findSymlinkedEntries("linked", globalSkills),
    ).resolves.toEqual(["dangling"]);

    await vault.upload("linked", globalSkills);
    const index = await vault.store.readIndex();
    // 符号链接的内容不会被加密同步：扫描器必须跳过它
    expect(Object.keys(index.files)).toEqual(["skills/linked/SKILL.md"]);
  });

  it("moves a skill into the vault and removes the local copy", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
      ["foo/references/note.md", Buffer.from("note")],
    ]);
    const { vault } = await createVault();

    const entry = await vault.upload("foo", globalSkills);

    expect(entry).toMatchObject({ name: "foo", fileCount: 2 });
    await expect(stat(join(globalSkills, "foo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(
        join(vault.store.moduleRoot("skills"), "foo", "references", "note.md"),
      ),
    ).resolves.toBeTruthy();
  });

  it("does not touch the local copy when the vault already has the skill", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const { vault } = await createVault();
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
    const { vault, sync } = await createVault();
    await vault.upload("foo", globalSkills);
    // 删除要求已同步：先真的同步一次（否则本机只剩密库这一份，云端还没有副本）
    await sync();

    await vault.remove("foo");

    await expect(vault.listVaultSkills()).resolves.toEqual([]);
    await expect(
      stat(join(vault.store.moduleRoot("skills"), "foo")),
    ).rejects.toMatchObject({
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
    const cloud = new FakeCloud();

    const sourceStore = new LocalVaultStore(join(root, "vault-a"));
    await sourceStore.ensureDirectory();
    const source = new VaultSkillsStore(sourceStore);
    await source.upload("foo", globalSkills);
    await new VaultSyncService(sourceStore, cloud, () => mek).sync("token");

    const targetStore = new LocalVaultStore(join(root, "vault-b"));
    await targetStore.ensureDirectory();
    const restored = await new VaultRestoreService(
      targetStore,
      cloud,
      () => mek,
    ).restoreWithLocalMek("token");

    expect(restored.restored).toBe(tree.length);
    for (const [name, contents] of tree) {
      const written = await readFile(
        join(targetStore.moduleRoot("skills"), name),
      );
      expect(sha256(written), name).toBe(sha256(contents));
    }
    expect(
      (await new VaultSkillsStore(targetStore).listVaultSkills())[0],
    ).toMatchObject({
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
    const { vault } = await createVault();

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
    const { vault } = await createVault();
    await vault.upload("foo", globalSkills);
    // 上传后条目标记 pending（尚未同步到云端）

    await expect(vault.remove("foo")).rejects.toThrow("VAULT_SKILL_NOT_SYNCED");
    await expect(vault.listVaultSkills()).resolves.toHaveLength(1);
  });

  it("moves a skill with rename so the source directory is gone", async () => {
    const globalSkills = await createGlobalSkills([
      ["foo/SKILL.md", Buffer.from("# foo")],
    ]);
    const { vault } = await createVault();

    await vault.upload("foo", globalSkills);

    await expect(stat(join(globalSkills, "foo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(vault.store.moduleRoot("skills"), "foo", "SKILL.md")),
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
    const { vault } = await createVault();

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
    const { vault } = await createVault();

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
    const { vault } = await createVault();

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
    const { vault } = await createVault();

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
    const { vault } = await createVault();

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
    const { vault } = await createVault();
    // 密库里先放一个同名技能 → 该技能必然失败
    const skillsRoot = vault.store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "already"), { recursive: true });
    await writeFile(join(skillsRoot, "already", "SKILL.md"), "# existing");

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
    const { vault } = await createVault();
    const spy = vi
      .spyOn(vault.store, "writeIndex")
      .mockRejectedValueOnce(new Error("VAULT_UNSUPPORTED_PATH:golden/bad."));

    const result = await vault.addSkills(["golden"], globalSkills, true);

    // 文件已经搬进密库：不能报成整批失败，但要把索引错误带出来
    expect(result.added).toEqual(["golden"]);
    expect(result.failed).toEqual([]);
    expect(result.indexError).toContain("VAULT_UNSUPPORTED_PATH");
    await expect(
      stat(join(vault.store.moduleRoot("skills"), "golden")),
    ).resolves.toBeTruthy();
    spy.mockRestore();
  });

  it("rejects names that are not skill directories before scanning", async () => {
    const globalSkills = await createGlobalSkills([
      ["ok/SKILL.md", Buffer.from("# ok")],
    ]);
    const { vault } = await createVault();

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
