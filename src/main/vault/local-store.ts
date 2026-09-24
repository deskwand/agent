import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { type SyncStatus, type VaultOperationStatus } from "../../shared/vault";
import { getVaultRoot } from "./paths";

const INDEX_FILE = ".vault-index.json";
const KEYCHAIN_FILE = "vault-mek.bin";
const OPERATION_FILE = ".vault-operation.json";
const STAGING_DIR = ".vault-staging";
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 顶层目录即模块：索引键、文件的根相对路径都以模块名开头。 */
export type VaultModule = "files" | "skills";
export const VAULT_MODULES = ["files", "skills"] as const;
const ROOT_INTERNAL = new Set<string>([
  INDEX_FILE,
  KEYCHAIN_FILE,
  OPERATION_FILE,
  STAGING_DIR,
]);

export function isVaultModule(value: string): value is VaultModule {
  return (VAULT_MODULES as readonly string[]).includes(value);
}

export interface LocalVaultEntry {
  objectId: string | null;
  hash: string | null;
  size: number;
  mtime: number;
  syncStatus: SyncStatus;
  objectHash?: string | null;
}

export interface LocalVaultIndex {
  version: 2;
  files: Record<string, LocalVaultEntry>;
  pendingDeletes: string[];
}

export interface LocalVaultFile {
  /** 根相对路径，如 `files/项目/笔记.md`。 */
  name: string;
  path: string;
  size: number;
  mtime: number;
  hash: string | null;
}

export type VaultOperationState = Exclude<VaultOperationStatus, "idle">;

export type VaultMarkerState = VaultOperationState | "committing";

export interface VaultOperationMarker {
  version: 1;
  id: string;
  kind: "restore" | "reset";
  state: VaultMarkerState;
  stagedDirectory?: string;
  targetNames?: string[];
}

export interface VaultRestoreTransaction {
  id: string;
  state: "staging" | "committing";
  stagedDirectory: string;
  targetNames: string[];
}

export interface LocalVaultState {
  hasIndex: boolean;
  files: LocalVaultFile[];
  operation: VaultOperationMarker | null;
}

function emptyIndex(): LocalVaultIndex {
  return { version: 2, files: {}, pendingDeletes: [] };
}

/**
 * 单个路径段能否安全跨设备同步。文件系统里「存在」不代表能同步：
 * `notes.` 在 Win32 上会被当作 `notes`，`con.md` 是保留设备名 —— 这类名字
 * 一旦进入索引，另一台设备上会解析成同一个文件或直接写不进去。
 *
 * 必须在**每一层**判定，不能只在根层：设备名规则与深度无关。
 */
function isUnsupportedScopeSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return true;
  if (/[. ]$/.test(segment)) return true;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment);
}

/**
 * 根相对路径（如 `files/项目/笔记.md`）能否安全存放：首段必须是模块，其余段
 * 沿用今天 skills scope 的路径规则（拒绝对路径、`..`、`\`，拒绝 Win32 会归一
 * 化的尾点/尾空格与保留设备名）。模块内部不保留任何名字：`.cache` 与
 * `vault-mek.bin` 都只在根层具有保留含义。
 */
function isVaultRelativePath(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  const segments = name.split("/");
  if (segments.length < 2 || !isVaultModule(segments[0])) return false;
  return segments.every((segment) => !isUnsupportedScopeSegment(segment));
}

/**
 * 索引键能否被索引读取器接受：只拒「逃出根目录」的形状。命名规则（尾点、
 * 设备名）不在这里判 —— 若读取器拒了扫描器接受的键，`readIndex` 会把整份索引
 * 判为损坏并重建，objectId 全丢、每轮重启重传全树。命名规则由扫描器在同步前
 * 用 `isVaultRelativePath` 拦下（`assertSyncableName`）。
 */
function isEscapingVaultPath(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0")) return true;
  if (name.startsWith("/") || name.endsWith("/")) return true;
  const segments = name.split("/");
  if (segments.length < 2 || !isVaultModule(segments[0])) return true;
  return segments.some(
    (segment) => !segment || segment === "." || segment === "..",
  );
}

function isSyncStatus(value: unknown): value is SyncStatus {
  return value === "synced" || value === "pending" || value === "failed";
}

function isVaultOperationMarker(value: unknown): value is VaultOperationMarker {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VaultOperationMarker>;
  return (
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    (candidate.kind === "restore" || candidate.kind === "reset") &&
    (candidate.state === "restoring" ||
      candidate.state === "committing" ||
      candidate.state === "resetting" ||
      candidate.state === "awaiting-recovery-code") &&
    (candidate.stagedDirectory === undefined ||
      typeof candidate.stagedDirectory === "string") &&
    (candidate.targetNames === undefined ||
      (Array.isArray(candidate.targetNames) &&
        candidate.targetNames.every((name) => typeof name === "string")))
  );
}

function isLocalIndex(value: unknown): value is LocalVaultIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    version?: unknown;
    files?: unknown;
    pendingDeletes?: unknown;
  };
  if (
    candidate.version !== 2 ||
    !candidate.files ||
    typeof candidate.files !== "object"
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate.pendingDeletes) ||
    !candidate.pendingDeletes.every((id) => typeof id === "string")
  ) {
    return false;
  }
  return Object.entries(candidate.files).every(([name, entry]) => {
    // 索引键只拒「逃出根目录」的形状，命名规则交给扫描器
    // （见 isEscapingVaultPath 的注释）。
    if (isEscapingVaultPath(name)) return false;
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<LocalVaultEntry>;
    return (
      (typeof item.objectId === "string" || item.objectId === null) &&
      (typeof item.hash === "string" || item.hash === null) &&
      typeof item.size === "number" &&
      item.size >= 0 &&
      typeof item.mtime === "number" &&
      Number.isFinite(item.mtime) &&
      (item.objectHash === undefined ||
        typeof item.objectHash === "string" ||
        item.objectHash === null) &&
      isSyncStatus(item.syncStatus)
    );
  });
}

async function fileHash(filePath: string): Promise<string> {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

export class LocalVaultStore {
  readonly rootDir: string;
  readonly indexPath: string;

  constructor(rootDir: string = getVaultRoot()) {
    this.rootDir = resolve(rootDir);
    this.indexPath = join(this.rootDir, INDEX_FILE);
  }

  /** 模块目录（`<root>/files`、`<root>/skills`）的绝对路径。 */
  moduleRoot(module: VaultModule): string {
    return join(this.rootDir, module);
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async hasIndex(): Promise<boolean> {
    try {
      await stat(this.indexPath);
      return true;
    } catch {
      return false;
    }
  }

  /** 删除根层的一个内部目录（例如上传/恢复暂存区）。仅用于内部清理，不写索引。 */
  async removeStaging(relativeDir: string): Promise<void> {
    const segments = relativeDir.split("/");
    const insideStaging =
      segments[0] === STAGING_DIR &&
      segments.every(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      );
    if (!insideStaging) throw new Error("VAULT_INVALID_NAME");
    await rm(join(this.rootDir, relativeDir), {
      recursive: true,
      force: true,
    });
  }

  async readIndex(): Promise<LocalVaultIndex> {
    await this.ensureDirectory();
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isLocalIndex(parsed)) throw new Error("VAULT_INDEX_INVALID");
      return parsed;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "VAULT_INDEX_INVALID") {
        return this.rebuildCorruptIndex();
      }
      if (error instanceof SyntaxError) return this.rebuildCorruptIndex();
      const code = error as NodeJS.ErrnoException;
      if (code.code === "ENOENT") return emptyIndex();
      throw error;
    }
  }

  async writeIndex(index: LocalVaultIndex): Promise<void> {
    await this.ensureDirectory();
    const tempPath = `${this.indexPath}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(tempPath, "w", 0o600);
    let renamed = false;
    try {
      await handle.writeFile(`${JSON.stringify(index, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(tempPath, this.indexPath);
      renamed = true;
    } finally {
      if (!renamed) {
        await handle.close().catch(() => undefined);
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    }

    try {
      const directory = await open(this.rootDir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error: unknown) {
      const code = error as NodeJS.ErrnoException;
      if (
        code.code !== "EINVAL" &&
        code.code !== "ENOTSUP" &&
        code.code !== "EPERM"
      ) {
        throw error;
      }
    }
  }

  async scanFiles(index?: LocalVaultIndex): Promise<LocalVaultFile[]> {
    await this.ensureDirectory();
    const files: LocalVaultFile[] = [];
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ROOT_INTERNAL.has(entry.name)) continue;
      if (!isVaultModule(entry.name) || !entry.isDirectory()) {
        throw new Error(`VAULT_UNSUPPORTED_PATH:${entry.name}`);
      }
      files.push(...(await this.scanModule(entry.name, "", index)));
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 递归扫描一个模块目录；索引快路径命中时沿用已记录的 hash。 */
  private async scanModule(
    module: VaultModule,
    prefix: string,
    index?: LocalVaultIndex,
  ): Promise<LocalVaultFile[]> {
    const directory = prefix
      ? join(this.moduleRoot(module), prefix)
      : this.moduleRoot(module);
    const entries = await readdir(directory, { withFileTypes: true });
    const files: LocalVaultFile[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // 模块内的隐藏目录（如 `files/.cache/`）也是用户内容，照扫。
        files.push(...(await this.scanModule(module, relative, index)));
        continue;
      }
      if (!entry.isFile()) continue;
      const name = `${module}/${relative}`;
      this.assertSyncableName(name);
      const file = await this.scanModuleFile(name, index);
      if (file) files.push(file);
    }
    return files;
  }

  private async scanModuleFile(
    name: string,
    index?: LocalVaultIndex,
  ): Promise<LocalVaultFile> {
    const path = this.filePath(name);
    const metadata = await lstat(path);
    const previous = index?.files[name];
    const hash =
      previous &&
      previous.size === metadata.size &&
      previous.mtime === metadata.mtimeMs
        ? previous.hash
        : null;
    return { name, path, size: metadata.size, mtime: metadata.mtimeMs, hash };
  }

  /**
   * 只读元数据的定向检查：上传前后的「文件有没有被改」全靠它，不读内容。
   */
  async statFile(
    name: string,
  ): Promise<{ size: number; mtime: number } | null> {
    this.assertSyncableName(name);
    try {
      const metadata = await lstat(this.filePath(name));
      if (!metadata.isFile()) return null;
      return { size: metadata.size, mtime: metadata.mtimeMs };
    } catch {
      return null;
    }
  }

  async scanFile(name: string): Promise<LocalVaultFile | null> {
    this.assertSyncableName(name);
    const path = this.filePath(name);
    // lstat does not follow symlinks, including dangling links. A missing file
    // throws ENOENT: returning null here would let the sync loop treat it as
    // "nothing to upload" and delete the remote object instead of failing.
    const metadata = await lstat(path);
    if (!metadata.isFile()) return null;
    const hash = await fileHash(path);
    return { name, path, size: metadata.size, mtime: metadata.mtimeMs, hash };
  }

  /**
   * 模块树里出现了无法跨设备同步的名字（尾点/尾空格、Windows 保留设备名）。
   * 必须抛错而不是跳过 —— 跳过会让 `reconcile` 把它判为「已删除」，同步时
   * 删掉云端对象。错误信息带上具体名字，让用户能重命名或删除它。
   */
  private assertSyncableName(name: string): void {
    if (isVaultRelativePath(name)) return;
    throw new Error(`VAULT_UNSUPPORTED_PATH:${name}`);
  }

  async reconcile(index: LocalVaultIndex): Promise<LocalVaultIndex> {
    const scanned = await this.scanFiles(index);
    const next: LocalVaultIndex = {
      version: 2,
      files: { ...index.files },
      pendingDeletes: [...index.pendingDeletes],
    };
    const present = new Set(scanned.map((file) => file.name));

    for (const [name, entry] of Object.entries(index.files)) {
      if (!present.has(name)) {
        if (entry.objectId && !next.pendingDeletes.includes(entry.objectId)) {
          next.pendingDeletes.push(entry.objectId);
        }
        delete next.files[name];
      }
    }

    for (const file of scanned) {
      const previous = index.files[file.name];
      if (
        !previous ||
        previous.hash !== file.hash ||
        previous.size !== file.size
      ) {
        next.files[file.name] = {
          objectId: previous?.objectId ?? null,
          hash: null,
          size: file.size,
          mtime: file.mtime,
          syncStatus: "pending",
          objectHash: previous?.objectHash ?? null,
        };
      } else {
        next.files[file.name] = { ...previous, mtime: file.mtime };
      }
    }
    return next;
  }

  async getUsageBytes(index?: LocalVaultIndex): Promise<number> {
    const current = index ?? (await this.reconcile(await this.readIndex()));
    return Object.values(current.files).reduce(
      (total, entry) => total + entry.size,
      0,
    );
  }

  async importFile(
    sourcePath: string,
  ): Promise<{ name: string; index: LocalVaultIndex }> {
    await this.ensureDirectory();
    await mkdir(this.moduleRoot("files"), { recursive: true });
    const source = await stat(sourcePath);
    if (!source.isFile()) throw new Error("VAULT_SOURCE_NOT_FILE");
    if (source.size > MAX_FILE_SIZE) throw new Error("VAULT_FILE_TOO_LARGE");

    const index = await this.reconcile(await this.readIndex());

    const originalName = basename(sourcePath);
    let name = `files/${originalName}`;
    this.validateName(name);
    let suffix = 1;
    while (await this.exists(name)) {
      const extension = extname(originalName);
      const stem = originalName.slice(
        0,
        originalName.length - extension.length,
      );
      name = `files/${stem} (${suffix})${extension}`;
      suffix += 1;
    }

    const destination = this.filePath(name);
    try {
      await copyFile(sourcePath, destination);
      const metadata = await stat(destination);
      index.files[name] = {
        objectId: null,
        hash: null,
        size: metadata.size,
        mtime: metadata.mtimeMs,
        syncStatus: "pending",
        objectHash: null,
      };
      await this.writeIndex(index);
      return { name, index };
    } catch (error: unknown) {
      await rm(destination, { force: true }).catch(() => undefined);
      if (isDiskFullError(error)) throw new Error("VAULT_LOCAL_DISK_FULL");
      throw error;
    }
  }

  async restoreFile(name: string, contents: Buffer): Promise<void> {
    await this.ensureDirectory();
    if (contents.length > MAX_FILE_SIZE) {
      throw new Error("VAULT_FILE_TOO_LARGE");
    }
    const path = this.filePath(name);
    await writeFile(path, contents, { flag: "wx" });
  }

  async removeFile(name: string): Promise<void> {
    await rm(this.filePath(name), { force: true });
  }

  async deleteFile(
    name: string,
  ): Promise<{ objectId: string | null; index: LocalVaultIndex }> {
    const path = this.filePath(name);
    const index = await this.readIndex();
    const entry = index.files[name];
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error("VAULT_NOT_FILE");
    await rm(path);
    delete index.files[name];
    if (entry?.objectId && !index.pendingDeletes.includes(entry.objectId)) {
      index.pendingDeletes.push(entry.objectId);
    }
    await this.writeIndex(index);
    return { objectId: entry?.objectId ?? null, index };
  }

  filePath(name: string): string {
    this.validateName(name);
    return join(this.rootDir, name);
  }

  async readOperationMarker(): Promise<VaultOperationMarker | null> {
    try {
      const raw = await readFile(this.operationPath(), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isVaultOperationMarker(parsed)) {
        await rm(this.operationPath(), { force: true }).catch(() => undefined);
        return null;
      }
      return parsed;
    } catch (error: unknown) {
      const code = error as NodeJS.ErrnoException;
      if (code.code === "ENOENT") return null;
      await rm(this.operationPath(), { force: true }).catch(() => undefined);
      return null;
    }
  }

  async writeOperationMarker(marker: VaultOperationMarker): Promise<void> {
    await this.ensureDirectory();
    const target = this.operationPath();
    const tempPath = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(tempPath, "w", 0o600);
    let renamed = false;
    try {
      await handle.writeFile(`${JSON.stringify(marker, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(tempPath, target);
      renamed = true;
    } finally {
      if (!renamed) {
        await handle.close().catch(() => undefined);
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async clearOperationMarker(): Promise<void> {
    await rm(this.operationPath(), { force: true });
  }

  async readState(): Promise<LocalVaultState> {
    const hasIndex = await this.hasIndex();
    const files = await this.scanFiles();
    const operation = await this.readOperationMarker();
    return { hasIndex, files, operation };
  }

  async beginRestore(targetNames: string[]): Promise<VaultRestoreTransaction> {
    await this.ensureDirectory();
    const id = randomUUID();
    const stagedDirectory = join(this.rootDir, STAGING_DIR, id);
    const marker: VaultOperationMarker = {
      version: 1,
      id,
      kind: "restore",
      state: "restoring",
      stagedDirectory,
      targetNames: [...targetNames],
    };
    await this.writeOperationMarker(marker);
    await mkdir(stagedDirectory, { recursive: true, mode: 0o700 });
    return {
      id,
      state: "staging",
      stagedDirectory,
      targetNames: [...targetNames],
    };
  }

  async stageRestoreFile(
    transaction: VaultRestoreTransaction,
    name: string,
    contents: Buffer,
  ): Promise<void> {
    // 不再按 MAX_FILE_SIZE 拦截：那个上限只是「用户手动导入文件」的护栏，上传侧
    // 并不用它。若在恢复侧拒绝，一旦云端存在超限对象（技能目录里的模型文件就是
    // 例子），恢复会整体 rollback 而本地原件已在上传后删除，备份就联系不上了。
    // 空间上限由服务端配额负责。
    this.validateName(name);
    const destination = join(transaction.stagedDirectory, name);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async commitRestore(
    transaction: VaultRestoreTransaction,
    entries: Record<string, LocalVaultEntry>,
  ): Promise<void> {
    const marker = await this.readOperationMarker();
    if (marker && marker.id === transaction.id) {
      await this.writeOperationMarker({ ...marker, state: "committing" });
    }
    try {
      for (const name of transaction.targetNames) {
        const destination = this.filePath(name);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await rename(join(transaction.stagedDirectory, name), destination);
      }
      const localIndex = await this.readIndex();
      for (const [name, entry] of Object.entries(entries)) {
        localIndex.files[name] = entry;
      }
      await this.writeIndex(localIndex);
      await rm(transaction.stagedDirectory, {
        recursive: true,
        force: true,
      });
      await this.clearOperationMarker();
    } catch (error: unknown) {
      await this.rollbackRestore(transaction);
      throw error;
    }
  }

  async rollbackRestore(transaction: VaultRestoreTransaction): Promise<void> {
    for (const name of transaction.targetNames) {
      await rm(this.filePath(name), { force: true }).catch(() => undefined);
    }
    await rm(transaction.stagedDirectory, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await this.clearOperationMarker();
  }

  async recoverPendingRestore(): Promise<void> {
    const marker = await this.readOperationMarker();
    if (!marker || marker.kind !== "restore") return;
    const targetNames = marker.targetNames ?? [];

    if (marker.state === "committing") {
      const index = await this.readIndex();
      let committed = true;
      for (const name of targetNames) {
        if (!index.files[name]) {
          committed = false;
          break;
        }
        try {
          const metadata = await stat(this.filePath(name));
          if (!metadata.isFile()) {
            committed = false;
            break;
          }
        } catch {
          committed = false;
          break;
        }
      }
      if (!committed) {
        for (const name of targetNames) {
          await rm(this.filePath(name), { force: true }).catch(() => undefined);
          delete index.files[name];
        }
        if (await this.hasIndex()) await this.writeIndex(index);
      }
    }
    if (marker.stagedDirectory) {
      await rm(marker.stagedDirectory, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
    await this.clearOperationMarker();
  }

  private operationPath(): string {
    return join(this.rootDir, OPERATION_FILE);
  }

  private async exists(name: string): Promise<boolean> {
    try {
      await stat(this.filePath(name));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 根相对路径能否作为存储路径使用：首段必须是模块，且整条路径符合跨设备命名
   * 规则（拒穿越、绝对路径、`\`，拒绝 Win32 会归一化的尾点/尾空格与保留设备名）。
   * 调用方（IPC / 同步 / 技能聚合）拿到的名字不合法时统一报 `VAULT_INVALID_NAME`。
   */
  private validateName(name: string): void {
    if (isEscapingVaultPath(name) || !isVaultRelativePath(name)) {
      throw new Error("VAULT_INVALID_NAME");
    }
    const resolved = resolve(this.rootDir, name);
    if (!resolved.startsWith(`${this.rootDir}${sep}`)) {
      throw new Error("VAULT_INVALID_NAME");
    }
  }

  private async rebuildCorruptIndex(): Promise<LocalVaultIndex> {
    const corruptPath = join(
      this.rootDir,
      STAGING_DIR,
      `${INDEX_FILE}.corrupt-${Date.now()}`,
    );
    try {
      await mkdir(dirname(corruptPath), { recursive: true });
      await rename(this.indexPath, corruptPath);
    } catch {
      // The index may have disappeared between read and rename.
    }
    const rebuilt = emptyIndex();
    for (const file of await this.scanFiles()) {
      rebuilt.files[file.name] = {
        objectId: null,
        hash: file.hash,
        size: file.size,
        mtime: file.mtime,
        syncStatus: "pending",
        objectHash: null,
      };
    }
    await this.writeIndex(rebuilt);
    return rebuilt;
  }
}

function isDiskFullError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOSPC";
}
