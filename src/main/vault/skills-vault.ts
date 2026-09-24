import { copyFile, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { removeManifestEntry } from "../skills/agent-manifest";
import { loadMek } from "./keychain";
import { FetchVaultCloudClient, type VaultCloudClient } from "./cloud-client";
import { LocalVaultStore } from "./local-store";
import { getVaultSkillsRoot } from "./paths";
import { VaultRestoreService, VaultSyncService } from "./sync";
import type { VaultSkillEntry, VaultSkillPreflight } from "../../shared/vault";

export type { VaultSkillEntry, VaultSkillPreflight };
import { MAX_FILE_SIZE } from "./local-store";

/** 上传时先落到这个隐藏目录，复制完整后再原子 rename 进最终位置。 */
const STAGING_DIR = ".vault-upload-staging";

/** 技能名即目录名，与 skills-manager 的 kebab-case 约定一致。 */
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await copyTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    await copyFile(from, to);
  }
}

/**
 * 技能密库：一个 `scope: "skills"` 的 store 及其同步/恢复服务。
 *
 * 根目录独立于 `~/.deskwand/skills`（见 `paths.ts`）；本类只负责把 store 与
 * 服务装配起来，并提供「按技能聚合」的列表视图。
 */
export class VaultSkillsStore {
  readonly store: LocalVaultStore;
  readonly syncService: VaultSyncService;
  readonly restoreService: VaultRestoreService;

  /** cloud 与 mekProvider 可注入：端到端往返测试要用替身，不能写死。 */
  constructor(
    rootDir: string = getVaultSkillsRoot(),
    cloud: VaultCloudClient = new FetchVaultCloudClient(),
    mekProvider: () => Buffer | null = loadMek,
  ) {
    this.store = new LocalVaultStore(rootDir, "skills");
    this.syncService = new VaultSyncService(this.store, cloud, mekProvider);
    this.restoreService = new VaultRestoreService(
      this.store,
      cloud,
      mekProvider,
    );
  }

  /** 清理上次中断留下的暂存目录。读索引之前调用，否则它会被当成一个技能。 */
  async removeStaleStaging(): Promise<void> {
    await this.store.removeStaging(STAGING_DIR);
  }

  /**
   * 上传前的体检。**只报告不拦截** —— 超限文件、symlink、配额差额都交给用户决定。
   */
  async preflight(
    skillName: string,
    globalSkillsPath: string,
    availableBytes: number | null = null,
  ): Promise<VaultSkillPreflight> {
    const source = join(globalSkillsPath, skillName);
    const oversizedFiles: VaultSkillPreflight["oversizedFiles"] = [];
    const symlinkedEntries: string[] = [];
    let fileCount = 0;
    let totalBytes = 0;

    const walk = async (relative: string): Promise<void> => {
      const absolute = relative ? join(source, relative) : source;
      const entries = await readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          symlinkedEntries.push(`${skillName}/${child}`);
          continue;
        }
        if (entry.isDirectory()) {
          await walk(child);
          continue;
        }
        if (!entry.isFile()) continue;
        const metadata = await lstat(join(source, child));
        fileCount += 1;
        totalBytes += metadata.size;
        if (metadata.size > MAX_FILE_SIZE) {
          oversizedFiles.push({
            relativePath: `${skillName}/${child}`,
            size: metadata.size,
          });
        }
      }
    };

    await walk("");

    // 配额差额：只有知道云端还剩多少字节时才能算（渲染层从 getBackupUsage 拿到）。
    const quotaShortfallBytes =
      availableBytes !== null && totalBytes > availableBytes
        ? totalBytes - availableBytes
        : null;

    return {
      skillName,
      fileCount,
      totalBytes,
      oversizedFiles,
      symlinkedEntries,
      quotaShortfallBytes,
    };
  }

  /**
   * 把本地技能搬进密库。两阶段提交：先写暂存目录、复制完整后原子 rename。
   * 复制失败只留暂存垃圾（`removeStaleStaging` 清理），不会污染密库；
   * 密库落盘成功之后才删本地原件。
   */
  async upload(
    skillName: string,
    globalSkillsPath: string,
  ): Promise<VaultSkillEntry> {
    if (!SKILL_NAME_RE.test(skillName)) {
      throw new Error(`VAULT_INVALID_SKILL_NAME:${skillName}`);
    }
    const source = join(globalSkillsPath, skillName);
    const destination = join(this.store.rootDir, skillName);
    if (existsSync(destination)) {
      throw new Error(`VAULT_SKILL_NAME_TAKEN:${skillName}`);
    }

    const staged = join(this.store.rootDir, STAGING_DIR, skillName);
    await rm(staged, { recursive: true, force: true });
    await mkdir(dirname(staged), { recursive: true, mode: 0o700 });
    try {
      await copyTree(source, staged);
    } catch (error: unknown) {
      await rm(staged, { recursive: true, force: true });
      throw error;
    }

    await rename(staged, destination);

    const index = await this.store.reconcile(await this.store.readIndex());
    await this.store.writeIndex(index);

    await rm(source, { recursive: true, force: true });
    try {
      removeManifestEntry(globalSkillsPath, skillName);
    } catch {
      // manifest 清理失败不应回滚已经完成的搬移
    }

    const entries = await this.listVaultSkills();
    const uploaded = entries.find((item) => item.name === skillName);
    if (!uploaded) throw new Error(`VAULT_SKILL_UPLOAD_FAILED:${skillName}`);
    return uploaded;
  }

  async remove(skillName: string): Promise<void> {
    if (!SKILL_NAME_RE.test(skillName)) {
      throw new Error(`VAULT_INVALID_SKILL_NAME:${skillName}`);
    }
    // 本机可能只剩这一份（上传后本地原件已删），云端若还没有副本就没有退路了。
    const entries = await this.listVaultSkills();
    const skill = entries.find((item) => item.name === skillName);
    if (skill && skill.syncStatus !== "synced") {
      throw new Error(`VAULT_SKILL_NOT_SYNCED:${skillName}`);
    }
    await rm(join(this.store.rootDir, skillName), {
      recursive: true,
      force: true,
    });
    const index = await this.store.reconcile(await this.store.readIndex());
    await this.store.writeIndex(index);
  }

  /**
   * 可上传的本地技能：全局目录下的真实目录、有 SKILL.md、且还不在密库里。
   * **名字必须能通过 SKILL_NAME_RE** —— 否则候选里会出现一个点了就报错的项。
   */
  async listUploadCandidates(globalSkillsPath: string): Promise<string[]> {
    if (!existsSync(globalSkillsPath)) return [];
    const entries = await readdir(globalSkillsPath, { withFileTypes: true });
    const inVault = new Set(
      (await this.listVaultSkills()).map((skill) => skill.name),
    );
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          SKILL_NAME_RE.test(entry.name) &&
          !inVault.has(entry.name) &&
          existsSync(join(globalSkillsPath, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  async listVaultSkills(): Promise<VaultSkillEntry[]> {
    const index = await this.store.reconcile(await this.store.readIndex());
    const bySkill = new Map<string, VaultSkillEntry>();
    for (const [path, entry] of Object.entries(index.files)) {
      const name = path.includes("/") ? path.slice(0, path.indexOf("/")) : "";
      if (!name) continue;
      const current = bySkill.get(name) ?? {
        name,
        fileCount: 0,
        totalBytes: 0,
        syncStatus: "synced" as const,
      };
      current.fileCount += 1;
      current.totalBytes += entry.size;
      if (entry.syncStatus !== "synced") current.syncStatus = entry.syncStatus;
      bySkill.set(name, current);
    }
    return [...bySkill.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
