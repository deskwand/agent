import { createHash } from "node:crypto";
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
import type { SyncStatus } from "../../shared/vault";

const INDEX_FILE = ".vault-index.json";
const KEYCHAIN_FILE = "vault-mek.bin";
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

function emptyIndex(): LocalVaultIndex {
  return { version: 1, files: {}, pendingDeletes: [] };
}

export function isReservedVaultName(name: string): boolean {
  return (
    name === KEYCHAIN_FILE ||
    name === INDEX_FILE ||
    name.startsWith(`${INDEX_FILE}.`)
  );
}

function isSyncStatus(value: unknown): value is SyncStatus {
  return value === "synced" || value === "pending" || value === "failed";
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
    if (
      !name ||
      isReservedVaultName(name) ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      return false;
    }
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
    const tempPath = `${this.indexPath}.tmp-${process.pid}-${Date.now()}`;
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

  async importFile(
    sourcePath: string,
  ): Promise<{ name: string; index: LocalVaultIndex }> {
    await this.ensureDirectory();
    const source = await stat(sourcePath);
    if (!source.isFile()) throw new Error("VAULT_SOURCE_NOT_FILE");
    if (source.size > MAX_FILE_SIZE) throw new Error("VAULT_FILE_TOO_LARGE");

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
      const index = await this.readIndex();
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
