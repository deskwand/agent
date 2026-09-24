import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  removeManifestEntries,
  removeManifestEntry,
} from "../skills/agent-manifest";
import { logWarn } from "../utils/logger";
import { loadMek } from "./keychain";
import { FetchVaultCloudClient, type VaultCloudClient } from "./cloud-client";
import { LocalVaultStore } from "./local-store";
import { getVaultSkillsRoot } from "./paths";
import { VaultRestoreService, VaultSyncService } from "./sync";
import type {
  AddSkillsResult,
  VaultAddableSkill,
  VaultSkillEntry,
} from "../../shared/vault";

export type { AddSkillsResult, VaultAddableSkill, VaultSkillEntry };

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
   * 把本地技能搬进密库。两阶段提交：先写暂存目录、复制完整后原子 rename。
   * 复制失败只留暂存垃圾（`removeStaleStaging` 清理），不会污染密库；
   * 密库落盘成功之后才删本地原件。
   */
  async upload(
    skillName: string,
    globalSkillsPath: string,
  ): Promise<VaultSkillEntry> {
    await this.moveIntoVault(skillName, globalSkillsPath);
    await this.writeIndexNow();
    this.cleanupManifest(globalSkillsPath, skillName);

    const entries = await this.listVaultSkills();
    const uploaded = entries.find((item) => item.name === skillName);
    if (!uploaded) throw new Error(`VAULT_SKILL_UPLOAD_FAILED:${skillName}`);
    return uploaded;
  }

  /**
   * 把技能目录挪进密库。**不碰索引** —— 批量加入时由调用方在所有搬移完成后统一
   * 写一次索引（逐个技能写会让整份索引被解析 + 原子写入 n 次，索引还随每个技能变大）。
   *
   * 同一文件系统下 rename 是原子瞬时操作（源目录与密库根都在 ~/.deskwand 下）。
   * 跨文件系统（EXDEV）才回退到「复制到暂存 → 原子 rename → 删原件」。
   */
  private async moveIntoVault(
    skillName: string,
    globalSkillsPath: string,
  ): Promise<void> {
    if (!SKILL_NAME_RE.test(skillName)) {
      throw new Error(`VAULT_INVALID_SKILL_NAME:${skillName}`);
    }
    const source = join(globalSkillsPath, skillName);
    const destination = join(this.store.rootDir, skillName);
    if (existsSync(destination)) {
      throw new Error(`VAULT_SKILL_NAME_TAKEN:${skillName}`);
    }
    // rename 需要目标父目录已存在；旧实现靠「先建暂存目录」顺带建出了密库根，
    // rename-first 必须显式建。
    await this.store.ensureDirectory();

    try {
      await rename(source, destination);
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") throw error;
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
    await rm(source, { recursive: true, force: true });
  }

  private async writeIndexNow(): Promise<void> {
    const index = await this.store.reconcile(await this.store.readIndex());
    await this.store.writeIndex(index);
  }

  private cleanupManifest(globalSkillsPath: string, skillName: string): void {
    try {
      removeManifestEntry(globalSkillsPath, skillName);
    } catch {
      // manifest 清理失败不应回滚已经完成的搬移
    }
  }

  /**
   * 批量加入密库。逐个独立执行：一个失败不影响其它。
   *
   * `confirmSkippedLinks` 为假时先扫一遍符号链接 —— 技能内部含链接的条目不会被
   * 加密同步，必须先让用户知道；有链接时只返回 needsConfirmation、磁盘不动。
   */
  async addSkills(
    names: string[],
    globalSkillsPath: string,
    confirmSkippedLinks = false,
  ): Promise<AddSkillsResult> {
    const failed: AddSkillsResult["failed"] = [];
    const requested: string[] = [];
    for (const name of names) {
      // 先校验再碰磁盘：非法名不进入符号链接扫描（那会读到技能目录之外）
      if (!SKILL_NAME_RE.test(name)) {
        failed.push({ name, reason: `VAULT_INVALID_SKILL_NAME:${name}` });
        continue;
      }
      if (!requested.includes(name)) requested.push(name);
    }

    if (!confirmSkippedLinks) {
      const needsConfirmation: NonNullable<
        AddSkillsResult["needsConfirmation"]
      > = [];
      for (const name of requested) {
        const symlinkedEntries = await this.findSymlinkedEntries(
          name,
          globalSkillsPath,
        );
        if (symlinkedEntries.length > 0) {
          needsConfirmation.push({ name, symlinkedEntries });
        }
      }
      if (needsConfirmation.length > 0) {
        return { needsConfirmation, added: [], failed };
      }
    }

    const added: string[] = [];
    for (const name of requested) {
      try {
        await this.moveIntoVault(name, globalSkillsPath);
        added.push(name);
      } catch (error: unknown) {
        failed.push({ name, reason: errorReason(error, name) });
      }
    }

    if (added.length === 0) return { added, failed };

    // 索引与 manifest 都是整份文件，各自只处理一次。
    let indexError: string | undefined;
    try {
      await this.writeIndexNow();
    } catch (error: unknown) {
      // 文件已经搬进密库了，索引是它的派生视图（下一次 reconcile 会补上），
      // 所以不算整批失败；但调用方必须能把这个错误显示出来。
      indexError = errorReason(error, "VAULT_INDEX_WRITE_FAILED");
      logWarn("[VaultSkills] Failed to write the index after moving:", error);
    }
    try {
      // 放在索引之后单独 try：索引写失败不该连带跳过 manifest 清理
      removeManifestEntries(globalSkillsPath, added);
    } catch (error: unknown) {
      logWarn("[VaultSkills] Failed to clean the manifest:", error);
    }

    return indexError ? { added, failed, indexError } : { added, failed };
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

  /** 技能内部的符号链接（相对技能目录的路径）。这些内容不会被加密同步。 */
  async findSymlinkedEntries(
    skillName: string,
    globalSkillsPath: string,
  ): Promise<string[]> {
    if (!SKILL_NAME_RE.test(skillName)) return [];
    const root = join(globalSkillsPath, skillName);
    const found: string[] = [];

    const walk = async (relative: string): Promise<void> => {
      const absolute = relative ? join(root, relative) : root;
      let entries;
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          found.push(child);
          continue;
        }
        if (entry.isDirectory()) await walk(child);
      }
    };

    await walk("");
    return found;
  }

  /**
   * 可加入的本地技能：真目录、kebab 名、有 SKILL.md、尚未在密库。
   *
   * 描述按「尽力而为」读取：`skills-manager.getSkillMetadata()` 在缺 name/description
   * 时返回 null，但候选判定只要求 SKILL.md 存在 —— 不能因为解析不出描述就把条目
   * 剔掉，否则一个没写 description 的技能会从清单消失、再也加不进密库。
   */
  async listUploadCandidates(
    globalSkillsPath: string,
    inVaultNames?: Iterable<string>,
  ): Promise<VaultAddableSkill[]> {
    if (!existsSync(globalSkillsPath)) return [];
    const entries = await readdir(globalSkillsPath, { withFileTypes: true });
    // 调用方已经算过密库技能名时直接复用：listVaultSkills 会读完索引再扫描全树
    const inVault = new Set(
      inVaultNames ?? (await this.listVaultSkills()).map((skill) => skill.name),
    );
    const candidates: VaultAddableSkill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (!SKILL_NAME_RE.test(entry.name)) continue;
      if (inVault.has(entry.name)) continue;
      const skillMdPath = join(globalSkillsPath, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      candidates.push({
        name: entry.name,
        description: readSkillDescription(skillMdPath),
      });
    }
    return candidates.sort((a, b) => a.name.localeCompare(b.name));
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

/**
 * 读 SKILL.md front-matter 里的 description，失败一律返回空串。
 *
 * 规则与 skills-manager.getSkillMetadata() 一致（同一个 yaml 解析器），只是这里不把
 * 「缺描述」当成不可用 —— 那份实现会因此跳过整个技能，用它来判定候选会让条目凭空消失。
 */
function readSkillDescription(skillMdPath: string): string {
  try {
    const content = readFileSync(skillMdPath, "utf-8");
    const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontMatter) return "";
    const parsed = parseYaml(frontMatter[1]) as {
      description?: unknown;
    } | null;
    return typeof parsed?.description === "string"
      ? parsed.description.trim()
      : "";
  } catch {
    return "";
  }
}

/** 错误 → 带码的消息（IPC 契约与渲染层都按这个格式解析）。 */
function errorReason(error: unknown, fallbackCode: string): string {
  return error instanceof Error ? error.message : fallbackCode;
}
