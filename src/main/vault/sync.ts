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
import type { LocalVaultEntry, LocalVaultStore } from "./local-store";
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
    const encryptedIndex = await this.cloud.getIndex(token);
    if (!encryptedIndex) throw new Error("VAULT_NO_REMOTE_BACKUP");
    return this.performRestore(token, mek, encryptedIndex);
  }

  async restoreWithRecoveryCode(
    token: string,
    recoveryCode: string,
  ): Promise<RestoreResult> {
    const encryptedIndex = await this.cloud.getIndex(token);
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
      remote = decodeRemoteIndex(encryptedIndex, mek);
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
    for (const [name, entry] of Object.entries(remote.files)) {
      // 大小写不敏感卷上的冲突：两条路径如果在某个路径段上「仅大小写不同」、
      // 且该段之前的各段完全相同，就会落在同一个文件或目录上
      // （"Foo/x.md" vs "foo/y.md" 是同一目录；"foo/A.md" vs "foo/a.md" 是同一文件）。
      // 统一命名空间后这条检测覆盖全部条目，不再按 scope 分叉。
      const collides = [...resolvedNames].some((used) =>
        pathsCollideIgnoringCase(used, name),
      );
      if (collides) {
        // 这条错误将来是要显示给用户的，必须说清是「远端索引内部」的冲突：
        // 如果只说“名字已被占用”，用户会去本地找那个文件，永远找不到。
        throw new Error(`VAULT_SKILL_NAME_CONFLICT:${name}`);
      }
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

    return { restored: resolved.length, renamed: 0 };
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
    /** 内容已上传、只差索引的条目：不参与 putIndex 失败时的对象回滚。 */
    const retryNames: string[] = [];
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
        // 只看元数据：扫描与守卫都不再读文件内容。
        const before = await this.store.statFile(name);
        if (!before) {
          // 扫描之后文件消失：按删除处理并回收云端对象（与 reconcile 的判定一致）。
          if (
            entry.objectId &&
            !index.pendingDeletes.includes(entry.objectId)
          ) {
            index.pendingDeletes.push(entry.objectId);
          }
          delete index.files[name];
          await this.store.writeIndex(index);
          remoteDirty = true;
          continue;
        }
        if (
          entry.hash !== null &&
          entry.hash === entry.objectHash &&
          before.size === entry.size &&
          before.mtime === entry.mtime
        ) {
          // 内容就是上次成功上传的那一版，只差索引未写：补写即可，不重读不重传。
          retryNames.push(name);
          remoteDirty = true;
          continue;
        }
        const oldObjectId = entry.objectId;
        previousObjectIds.set(name, oldObjectId);
        // 一次读取：同一份字节同时算出内容 hash 与密文。
        const packed = await packFile(this.store.filePath(name), mek);
        uploadedObjectId = packed.id;
        await this.cloud.putObject(token, packed.id, packed.payload);
        const after = await this.store.statFile(name);
        if (
          !after ||
          after.size !== before.size ||
          after.mtime !== before.mtime
        ) {
          // 上传途中被改：本轮作废，下一轮重来。
          entry.syncStatus = "pending";
          entry.hash = null;
          if (!index.pendingDeletes.includes(packed.id)) {
            index.pendingDeletes.push(packed.id);
          }
          await this.store.writeIndex(index);
          remoteDirty = true;
          continue;
        }

        entry.objectId = packed.id;
        entry.objectHash = packed.hash;
        entry.hash = packed.hash;
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
      const settledNames = [...changedNames, ...retryNames];
      for (const name of settledNames) {
        index.files[name].syncStatus = "synced";
      }
      if (settledNames.length > 0) await this.store.writeIndex(index);
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

    const remotePayload = await this.cloud.getIndex(token);
    if (remotePayload) {
      const remote = decodeRemoteIndex(remotePayload, current);
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
      encodeRemoteIndex({ version: 2, files: {} }, current),
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
        encodeRemoteIndex({ version: 2, files: {} }, this.pendingMek),
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

    // 这条路径上没有 MEK，拿不到远端索引的内容，只能列出账号下的全部对象；
    // 统一存储后整账号只有一个密库，列出来的就是要删的。
    let objectIds: string[];
    try {
      objectIds = await this.cloud.listObjectIds(token);
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
