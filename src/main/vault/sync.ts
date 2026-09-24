import { randomUUID } from "node:crypto";
import { deriveMek } from "./crypto";
import { packFile, unpack } from "./objects";
import { loadMek, storeMek } from "./keychain";
import { generateRecoveryCode } from "./recovery";
import {
  decodeRemoteIndex,
  encodeRemoteIndex,
  toRemoteIndex,
  type RemoteVaultEntry,
} from "./vault-index";
import {
  isReservedVaultName,
  type LocalVaultEntry,
  type LocalVaultStore,
} from "./local-store";
import { VaultCloudError, type VaultCloudClient } from "./cloud-client";
import type {
  RestoreResult,
  VaultResetPreparation,
  VaultResetResult,
} from "../../shared/vault";

export type { VaultResetPreparation, VaultResetResult };

export type { VaultCloudClient } from "./cloud-client";

export interface SyncResult {
  uploaded: number;
  deleted: number;
  pending: number;
  failed: number;
  errorCode?: string;
}

type MekProvider = () => Buffer | null;

function quotaErrorCode(error: unknown): string | null {
  if (!(error instanceof VaultCloudError)) return null;
  return error.code === "VAULT_QUOTA_EXCEEDED" ||
    error.message === "VAULT_QUOTA_EXCEEDED"
    ? "VAULT_QUOTA_EXCEEDED"
    : null;
}

export class VaultRestoreService {
  constructor(
    private readonly store: LocalVaultStore,
    private readonly cloud: VaultCloudClient,
    private readonly mekProvider: MekProvider = loadMek,
    private readonly persistMek: (mek: Buffer) => void = storeMek,
  ) {}

  async restoreWithLocalMek(token: string): Promise<RestoreResult> {
    const mek = this.mekProvider();
    if (!mek) throw new Error("VAULT_KEY_REQUIRED");
    const encryptedIndex = await this.cloud.getIndex(token, this.store.scope);
    if (!encryptedIndex) throw new Error("VAULT_NO_REMOTE_BACKUP");
    return this.performRestore(token, mek, encryptedIndex);
  }

  async restoreWithRecoveryCode(
    token: string,
    recoveryCode: string,
  ): Promise<RestoreResult> {
    const encryptedIndex = await this.cloud.getIndex(token, this.store.scope);
    if (!encryptedIndex) throw new Error("VAULT_NO_REMOTE_BACKUP");
    const mek = deriveMek(recoveryCode);
    const current = this.mekProvider();
    if (current && !current.equals(mek)) {
      throw new Error("VAULT_ALREADY_INITIALIZED");
    }
    const result = await this.performRestore(token, mek, encryptedIndex);
    // Only persist the MEK after download, decrypt and local commit succeed.
    if (!current) this.persistMek(mek);
    return result;
  }

  private async performRestore(
    token: string,
    mek: Buffer,
    encryptedIndex: Buffer,
  ): Promise<RestoreResult> {
    let remote: ReturnType<typeof decodeRemoteIndex>;
    try {
      remote = decodeRemoteIndex(encryptedIndex, mek, this.store.scope);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === "VAULT_INDEX_AUTH_FAILED"
      ) {
        throw new Error("VAULT_RECOVERY_MISMATCH");
      }
      throw error;
    }

    // Refuse to restore over existing local state.
    if (await this.store.hasIndex())
      throw new Error("VAULT_LOCAL_INDEX_EXISTS");
    if ((await this.store.scanFiles()).length > 0) {
      throw new Error("VAULT_LOCAL_FILES_EXIST");
    }

    const resolvedNames = new Set<string>();
    const resolved: Array<{ name: string; entry: RemoteVaultEntry }> = [];
    let renamed = 0;
    for (const [originalName, entry] of Object.entries(remote.files)) {
      if (isReservedVaultName(originalName)) continue;
      const name =
        this.store.scope === "files"
          ? uniqueRestoreName(originalName, resolvedNames)
          : originalName;
      if (this.store.scope === "skills") {
        // 大小写不敏感卷上的冲突：两条路径如果在某个路径段上「仅大小写不同」、
        // 且该段之前的各段完全相同，就会落在同一个文件或目录上
        // （"Foo/x.md" vs "foo/y.md" 是同一目录；"foo/A.md" vs "foo/a.md" 是同一文件）。
        // 只把整条路径小写化做比较是不够的：那样只能发现完全同名的冲突。
        const collides = [...resolvedNames].some((used) =>
          pathsCollideIgnoringCase(used, name),
        );
        if (collides) {
          // 这条错误将来是要显示给用户的，必须说清是「远端索引内部」的冲突：
          // 如果只说“名字已被占用”，用户会去本地找那个文件，永远找不到。
          throw new Error(`VAULT_SKILL_NAME_CONFLICT:${originalName}`);
        }
      }
      if (name !== originalName) renamed += 1;
      resolvedNames.add(name);
      resolved.push({ name, entry });
    }

    const entries: Record<string, LocalVaultEntry> = {};
    for (const { name, entry } of resolved) {
      entries[name] = {
        objectId: entry.objectId,
        hash: entry.hash,
        size: entry.size,
        mtime: entry.mtime,
        syncStatus: "synced",
        objectHash: entry.hash,
      };
    }

    const transaction = await this.store.beginRestore(
      resolved.map((item) => item.name),
    );
    try {
      for (const { name, entry } of resolved) {
        const payload = await this.cloud.getObject(token, entry.objectId);
        const contents = await unpack(payload, mek);
        await this.store.stageRestoreFile(transaction, name, contents);
      }
      await this.store.commitRestore(transaction, entries);
    } catch (error: unknown) {
      await this.store.rollbackRestore(transaction).catch(() => undefined);
      throw error;
    }

    return { restored: resolved.length, renamed };
  }
}

/**
 * 两条相对路径在大小写不敏感卷上是否指向同一个文件或目录。
 *
 * 逐段比较：前面各段必须**完全**相同（大小写也要一致，否则它们本来就是不同的
 * 目录），到第一处不同时，只有当两段仅大小写不同才算冲突。
 */
function pathsCollideIgnoringCase(a: string, b: string): boolean {
  const left = a.split("/");
  const right = b.split("/");
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index].toLowerCase() === right[index].toLowerCase();
  }
  // 前缀完全相同：一条是另一条的前缀（文件 vs 目录）或两者同名。
  return true;
}

function uniqueRestoreName(name: string, existingNames: Set<string>): string {
  const normalizedNames = new Set(
    [...existingNames].map((existingName) => existingName.toLowerCase()),
  );
  if (!normalizedNames.has(name.toLowerCase())) return name;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  let suffix = 1;
  let candidate = `${stem} (${suffix})${extension}`;
  while (normalizedNames.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem} (${suffix})${extension}`;
  }
  return candidate;
}

export class VaultSyncService {
  private syncQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: LocalVaultStore,
    private readonly cloud: VaultCloudClient,
    private readonly mekProvider: MekProvider = loadMek,
  ) {}

  sync(token: string): Promise<SyncResult> {
    const result = this.syncQueue.then(() => this.runSync(token));
    this.syncQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runSync(token: string): Promise<SyncResult> {
    const operation = await this.store.readOperationMarker();
    if (operation) {
      throw new Error(
        operation.kind === "reset"
          ? "VAULT_RESET_IN_PROGRESS"
          : "VAULT_RESTORE_IN_PROGRESS",
      );
    }
    const mek = this.mekProvider();
    if (!mek) throw new Error("VAULT_KEY_REQUIRED");

    let index = await this.store.readIndex();
    index = await this.store.reconcile(index);
    await this.store.writeIndex(index);

    const changedNames: string[] = [];
    const uploadedNames: string[] = [];
    const previousObjectIds = new Map<string, string | null>();
    let uploaded = 0;
    let failed = 0;
    let remoteDirty = false;
    let remoteIndexReady = false;
    let errorCode: string | undefined;

    for (const name of Object.keys(index.files)) {
      const entry = index.files[name];
      if (entry.syncStatus === "synced") continue;

      let uploadedObjectId: string | null = null;
      try {
        const before =
          this.store.scope === "skills"
            ? await this.store.scanFile(name)
            : (await this.store.scanFiles(index)).find(
                (file) => file.name === name,
              );
        if (!before) continue;
        if (
          entry.syncStatus === "failed" &&
          entry.objectId &&
          entry.objectHash === before.hash
        ) {
          changedNames.push(name);
          remoteDirty = true;
          continue;
        }
        const oldObjectId = entry.objectId;
        previousObjectIds.set(name, oldObjectId);
        const packed = await packFile(this.store.filePath(name), mek);
        await this.cloud.putObject(
          token,
          this.store.scope,
          packed.id,
          packed.payload,
        );
        uploadedObjectId = packed.id;
        const after =
          this.store.scope === "skills"
            ? await this.store.scanFile(name)
            : (await this.store.scanFiles(index)).find(
                (file) => file.name === name,
              );
        if (!after || after.hash !== before.hash) {
          entry.syncStatus = "pending";
          if (!index.pendingDeletes.includes(packed.id)) {
            index.pendingDeletes.push(packed.id);
          }
          await this.store.writeIndex(index);
          remoteDirty = true;
          continue;
        }

        entry.objectId = packed.id;
        entry.objectHash = after.hash;
        entry.hash = after.hash;
        entry.size = after.size;
        entry.mtime = after.mtime;
        entry.syncStatus = "pending";
        if (oldObjectId && !index.pendingDeletes.includes(oldObjectId)) {
          index.pendingDeletes.push(oldObjectId);
        }
        await this.store.writeIndex(index);
        changedNames.push(name);
        uploadedNames.push(name);
        remoteDirty = true;
        uploaded += 1;
      } catch (error: unknown) {
        errorCode = quotaErrorCode(error) ?? errorCode;
        entry.syncStatus = "failed";
        if (
          uploadedObjectId &&
          !index.pendingDeletes.includes(uploadedObjectId)
        ) {
          index.pendingDeletes.push(uploadedObjectId);
          remoteDirty = true;
        }
        await this.store.writeIndex(index);
        failed += 1;
        break;
      }
    }

    if (remoteDirty || index.pendingDeletes.length > 0) {
      try {
        await this.cloud.putIndex(
          token,
          this.store.scope,
          encodeRemoteIndex(toRemoteIndex(index), mek),
        );
        remoteIndexReady = true;
      } catch (error: unknown) {
        errorCode = quotaErrorCode(error) ?? errorCode;
        for (const name of changedNames) {
          const entry = index.files[name];
          const uploadedObjectId = entry.objectId;
          if (uploadedObjectId) {
            try {
              await this.cloud.deleteObject(token, uploadedObjectId);
            } catch {
              if (!index.pendingDeletes.includes(uploadedObjectId)) {
                index.pendingDeletes.push(uploadedObjectId);
              }
            }
          }
          entry.objectId = previousObjectIds.get(name) ?? null;
          entry.objectHash = null;
          entry.syncStatus = "failed";
        }
        await this.store.writeIndex(index);
        failed += changedNames.length;
        uploaded -= uploadedNames.length;
        uploadedNames.length = 0;
        changedNames.length = 0;
        previousObjectIds.clear();
      }
    }

    if (remoteIndexReady) {
      for (const name of changedNames) {
        index.files[name].syncStatus = "synced";
      }
      if (changedNames.length > 0) await this.store.writeIndex(index);
    }

    let deleted = 0;
    if (remoteIndexReady) {
      for (const objectId of [...index.pendingDeletes]) {
        try {
          await this.cloud.deleteObject(token, objectId);
          index.pendingDeletes = index.pendingDeletes.filter(
            (pendingId) => pendingId !== objectId,
          );
          await this.store.writeIndex(index);
          deleted += 1;
        } catch (error: unknown) {
          if (error instanceof VaultCloudError && error.status === 404) {
            index.pendingDeletes = index.pendingDeletes.filter(
              (pendingId) => pendingId !== objectId,
            );
            await this.store.writeIndex(index);
            deleted += 1;
          } else {
            failed += 1;
          }
        }
      }
    }

    const pending =
      Object.values(index.files).filter(
        (entry) => entry.syncStatus !== "synced",
      ).length + index.pendingDeletes.length;
    return { uploaded, deleted, pending, failed, errorCode };
  }
}

export class VaultResetService {
  private pendingCode: string | null = null;
  private pendingMek: Buffer | null = null;
  private pendingDeletedObjects = 0;

  constructor(
    private readonly store: LocalVaultStore,
    private readonly cloud: VaultCloudClient,
    private readonly loadCurrentMek: MekProvider = loadMek,
    private readonly persistMek: (mek: Buffer) => void = storeMek,
  ) {}

  async beginDiscardAndReinitialize(
    token: string,
  ): Promise<VaultResetPreparation> {
    const current = this.loadCurrentMek();
    if (!current) throw new Error("VAULT_KEY_REQUIRED");
    const marker = await this.store.readOperationMarker();
    if (marker?.kind === "restore") {
      throw new Error("VAULT_RESTORE_IN_PROGRESS");
    }
    if (marker?.kind === "reset" && marker.state === "awaiting-recovery-code") {
      throw new Error("VAULT_RESET_IN_PROGRESS");
    }

    const index = await this.store.reconcile(await this.store.readIndex());
    await this.store.writeIndex(index);
    const toDelete = new Set<string>();
    for (const entry of Object.values(index.files)) {
      if (entry.objectId) toDelete.add(entry.objectId);
    }
    for (const objectId of index.pendingDeletes) toDelete.add(objectId);

    const remotePayload = await this.cloud.getIndex(token, this.store.scope);
    if (remotePayload) {
      const remote = decodeRemoteIndex(
        remotePayload,
        current,
        this.store.scope,
      );
      for (const entry of Object.values(remote.files)) {
        toDelete.add(entry.objectId);
      }
    }

    await this.store.writeOperationMarker({
      version: 1,
      id: randomUUID(),
      kind: "reset",
      state: "resetting",
    });

    const orderedDeletes = [...toDelete].sort();
    try {
      for (const objectId of orderedDeletes) {
        await this.deleteRemoteObject(token, objectId);
      }
    } catch (error: unknown) {
      throw new Error("VAULT_RESET_FAILED");
    }

    await this.cloud.putIndex(
      token,
      this.store.scope,
      encodeRemoteIndex({ version: 1, files: {} }, current),
    );

    const newCode = generateRecoveryCode();
    const newMek = deriveMek(newCode);
    this.pendingCode = newCode;
    this.pendingMek = newMek;
    this.pendingDeletedObjects = orderedDeletes.length;

    await this.store.writeOperationMarker({
      version: 1,
      id: randomUUID(),
      kind: "reset",
      state: "awaiting-recovery-code",
    });

    return {
      recoveryCode: newCode,
      preservedLocalFiles: Object.keys(index.files).length,
    };
  }

  async completeDiscardAndReinitialize(
    token: string,
    recoveryCode: string,
  ): Promise<VaultResetResult> {
    if (!this.pendingCode || !this.pendingMek) {
      throw new Error("VAULT_RESET_IN_PROGRESS");
    }
    if (recoveryCode !== this.pendingCode) {
      throw new Error("VAULT_RECOVERY_MISMATCH");
    }

    const index = await this.store.readIndex();
    for (const name of Object.keys(index.files)) {
      index.files[name].objectId = null;
      index.files[name].objectHash = null;
      index.files[name].syncStatus = "pending";
    }
    index.pendingDeletes = [];

    try {
      // Publish an empty index under the candidate key before making it the
      // local key. The reset marker remains if either operation fails.
      await this.cloud.putIndex(
        token,
        this.store.scope,
        encodeRemoteIndex({ version: 1, files: {} }, this.pendingMek),
      );
      this.persistMek(this.pendingMek);
      await this.store.writeIndex(index);
      await this.store.clearOperationMarker();
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error ? error.message : "VAULT_RESET_FAILED",
      );
    }

    const result: VaultResetResult = {
      deletedObjects: this.pendingDeletedObjects,
      preservedLocalFiles: Object.keys(index.files).length,
    };
    this.pendingCode = null;
    this.pendingMek = null;
    this.pendingDeletedObjects = 0;
    return result;
  }

  async discardWithoutLocalKey(token: string): Promise<VaultResetResult> {
    const marker = await this.store.readOperationMarker();
    if (marker?.kind === "restore") {
      throw new Error("VAULT_RESTORE_IN_PROGRESS");
    }
    if (marker && marker.state === "awaiting-recovery-code") {
      // A previously-started discard already deleted the remote objects;
      // re-entering setup must not delete them again.
      return { deletedObjects: 0, preservedLocalFiles: 0 };
    }
    if (marker && marker.state === "resetting") {
      // Resume cleanup after a process restart; the marker is the durable
      // indication that the user already confirmed this destructive action.
    } else {
      await this.store.writeOperationMarker({
        version: 1,
        id: randomUUID(),
        kind: "reset",
        state: "resetting",
      });
    }

    // 列表按 scope 过滤（服务端 `GET /api/vault/objects?scope=`）：这条路径上没有
    // MEK，拿不到远端索引的内容，只能靠服务端分仓，否则技能密库的 reset 会把文件
    // 密库的对象一并删掉。
    let objectIds: string[];
    try {
      objectIds = await this.cloud.listObjectIds(token, this.store.scope);
    } catch (error: unknown) {
      throw new Error("VAULT_RESET_FAILED");
    }
    let deleted = 0;
    try {
      for (const objectId of objectIds) {
        await this.deleteRemoteObject(token, objectId);
        deleted += 1;
      }
    } catch (error: unknown) {
      throw new Error("VAULT_RESET_FAILED");
    }

    await this.store.writeOperationMarker({
      version: 1,
      id: randomUUID(),
      kind: "reset",
      state: "awaiting-recovery-code",
    });
    return {
      deletedObjects: deleted,
      preservedLocalFiles: (await this.store.scanFiles()).length,
    };
  }

  private async deleteRemoteObject(
    token: string,
    objectId: string,
  ): Promise<void> {
    try {
      await this.cloud.deleteObject(token, objectId);
    } catch (error: unknown) {
      if (error instanceof VaultCloudError && error.status === 404) return;
      throw error;
    }
  }
}
