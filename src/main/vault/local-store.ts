import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import {
  VAULT_LOCAL_QUOTA_BYTES,
  type SyncStatus,
  type VaultOperationStatus,
} from "../../shared/vault";

const INDEX_FILE = ".vault-index.json";
const KEYCHAIN_FILE = "vault-mek.bin";
const OPERATION_FILE = ".vault-operation.json";
const RESTORE_DIR = ".vault-restore";
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface LocalVaultEntry {
  objectId: string | null;
  hash: string;
  size: number;
  mtime: number;
  syncStatus: SyncStatus;
  objectHash?: string | null;
}

export interface LocalVaultIndex {
  version: 1;
  files: Record<string, LocalVaultEntry>;
  pendingDeletes: string[];
}

export interface LocalVaultFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  hash: string;
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
  return { version: 1, files: {}, pendingDeletes: [] };
}

export function isReservedVaultName(name: string): boolean {
  const normalized = name.toLowerCase();
  const keychainFile = KEYCHAIN_FILE.toLowerCase();
  const indexFile = INDEX_FILE.toLowerCase();
  const operationFile = OPERATION_FILE.toLowerCase();
  const restoreDir = RESTORE_DIR.toLowerCase();
  return (
    normalized === keychainFile ||
    normalized === indexFile ||
    normalized.startsWith(`${indexFile}.`) ||
    normalized === operationFile ||
    normalized.startsWith(`${operationFile}.`) ||
    normalized === restoreDir ||
    normalized.startsWith(`${restoreDir}/`) ||
    normalized.startsWith(`${restoreDir}${sep}`)
  );
}

function isVaultName(name: string): boolean {
  return (
    !!name &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\")
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
    candidate.version !== 1 ||
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
    // Internal/reserved names (e.g. a leaked legacy vault-mek.bin entry) are
    // valid index entries — they are reconciled out later, not treated as
    // corruption. Only reject path-traversal names.
    if (!name || !isVaultName(name)) return false;
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<LocalVaultEntry>;
    return (
      (typeof item.objectId === "string" || item.objectId === null) &&
      typeof item.hash === "string" &&
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

  constructor(rootDir = resolve(homedir(), ".deskwand", "vault")) {
    this.rootDir = resolve(rootDir);
    this.indexPath = join(this.rootDir, INDEX_FILE);
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
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const files: LocalVaultFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || isReservedVaultName(entry.name)) continue;
      const path = join(this.rootDir, entry.name);
      const metadata = await stat(path);
      const previous = index?.files[entry.name];
      const hash =
        previous &&
        previous.size === metadata.size &&
        previous.mtime === metadata.mtimeMs
          ? previous.hash
          : await fileHash(path);
      files.push({
        name: entry.name,
        path,
        size: metadata.size,
        mtime: metadata.mtimeMs,
        hash,
      });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async reconcile(index: LocalVaultIndex): Promise<LocalVaultIndex> {
    const scanned = await this.scanFiles(index);
    const next: LocalVaultIndex = {
      version: 1,
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
          hash: file.hash,
          size: file.size,
          mtime: file.mtime,
          syncStatus: "pending",
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
    const source = await stat(sourcePath);
    if (!source.isFile()) throw new Error("VAULT_SOURCE_NOT_FILE");
    if (source.size > MAX_FILE_SIZE) throw new Error("VAULT_FILE_TOO_LARGE");

    const index = await this.reconcile(await this.readIndex());
    if (
      (await this.getUsageBytes(index)) + source.size >
      VAULT_LOCAL_QUOTA_BYTES
    ) {
      throw new Error("VAULT_LOCAL_QUOTA_EXCEEDED");
    }

    const originalName = basename(sourcePath);
    this.validateName(originalName);
    let name = originalName;
    let suffix = 1;
    while (isReservedVaultName(name) || (await this.exists(name))) {
      const extension = extname(originalName);
      const stem = originalName.slice(
        0,
        originalName.length - extension.length,
      );
      name = `${stem} (${suffix})${extension}`;
      suffix += 1;
    }

    const destination = this.filePath(name);
    try {
      await copyFile(sourcePath, destination);
      const metadata = await stat(destination);
      index.files[name] = {
        objectId: null,
        hash: await fileHash(destination),
        size: metadata.size,
        mtime: metadata.mtimeMs,
        syncStatus: "pending",
        objectHash: null,
      };
      await this.writeIndex(index);
      return { name, index };
    } catch (error: unknown) {
      await rm(destination, { force: true }).catch(() => undefined);
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
    const stagedDirectory = join(this.rootDir, RESTORE_DIR, id);
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
    if (contents.length > MAX_FILE_SIZE)
      throw new Error("VAULT_FILE_TOO_LARGE");
    this.validateName(name);
    await mkdir(transaction.stagedDirectory, { recursive: true, mode: 0o700 });
    const handle = await open(
      join(transaction.stagedDirectory, name),
      "wx",
      0o600,
    );
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
        await rename(
          join(transaction.stagedDirectory, name),
          this.filePath(name),
        );
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

  private validateName(name: string): void {
    if (
      !name ||
      name === "." ||
      name === ".." ||
      isReservedVaultName(name) ||
      name.includes("/") ||
      name.includes("\\") ||
      basename(name) !== name
    ) {
      throw new Error("VAULT_INVALID_NAME");
    }
    const resolved = resolve(this.rootDir, name);
    if (!resolved.startsWith(`${this.rootDir}${sep}`)) {
      throw new Error("VAULT_INVALID_NAME");
    }
  }

  private async rebuildCorruptIndex(): Promise<LocalVaultIndex> {
    const corruptPath = `${this.indexPath}.corrupt-${Date.now()}`;
    try {
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
