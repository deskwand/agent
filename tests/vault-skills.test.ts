import { afterEach, describe, expect, it } from "vitest";
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

  it("reports oversized files without refusing the upload", async () => {
    const globalSkills = await createGlobalSkills([
      ["big/SKILL.md", Buffer.from("# big")],
      ["big/model.bin", Buffer.alloc(21 * 1024 * 1024)],
    ]);
    const vault = await createVault();

    const report = await vault.preflight("big", globalSkills);

    expect(report.skillName).toBe("big");
    expect(report.fileCount).toBe(2);
    expect(report.oversizedFiles).toEqual([
      { relativePath: "big/model.bin", size: 21 * 1024 * 1024 },
    ]);
    expect(report.symlinkedEntries).toEqual([]);
  });

  it("reports symlinked entries as not synced", async () => {
    const globalSkills = await createGlobalSkills([
      ["linked/SKILL.md", Buffer.from("# linked")],
    ]);
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    const vault = await createVault();

    const report = await vault.preflight("linked", globalSkills);

    expect(report.symlinkedEntries).toEqual(["linked/dangling"]);
    expect(report.oversizedFiles).toEqual([]);
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

    const names = await vault.listUploadCandidates(globalSkills);

    expect(names).toEqual(["good-name"]);
    // 每个候选都必须能真正上传成功（名字规则一致）
    for (const name of names) {
      await expect(vault.upload(name, globalSkills)).resolves.toMatchObject({
        name,
      });
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

  it("reports the quota shortfall when the cloud has less room than the skill", async () => {
    const globalSkills = await createGlobalSkills([
      ["big/SKILL.md", Buffer.alloc(1024)],
    ]);
    const vault = await createVault();

    const report = await vault.preflight("big", globalSkills, 100);

    expect(report.totalBytes).toBe(1024);
    expect(report.quotaShortfallBytes).toBe(924);
  });

  it("reports no shortfall when the quota is unknown", async () => {
    const globalSkills = await createGlobalSkills([
      ["small/SKILL.md", Buffer.alloc(10)],
    ]);
    const vault = await createVault();

    const report = await vault.preflight("small", globalSkills, null);

    expect(report.quotaShortfallBytes).toBeNull();
  });
});
