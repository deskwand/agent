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

export type {
  VaultResetPreparation,
  VaultResetResult,
} from "../../shared/vault";

export type { VaultCloudClient } from "./cloud-client";

export interface SyncResult {
  uploaded: number;
  deleted: number;
  pending: number;
  failed: number;
}

type MekProvider = () => Buffer | null;

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

    const existingNames = new Set<string>();
    const resolved: Array<{ name: string; entry: RemoteVaultEntry }> = [];
    let renamed = 0;
    for (const [originalName, entry] of Object.entries(remote.files)) {
      if (isReservedVaultName(originalName)) continue;
      const name = uniqueRestoreName(originalName, existingNames);
      if (name !== originalName) renamed += 1;
      existingNames.add(name);
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
    let uploaded = 0;
    let failed = 0;
    let remoteDirty = false;
    let remoteIndexReady = false;

    for (const name of Object.keys(index.files)) {
      const entry = index.files[name];
      if (entry.syncStatus === "synced") continue;

      let uploadedObjectId: string | null = null;
      try {
        const before = (await this.store.scanFiles(index)).find(
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
        const packed = await packFile(this.store.filePath(name), mek);
        await this.cloud.putObject(token, packed.id, packed.payload);
        uploadedObjectId = packed.id;
        const after = (await this.store.scanFiles(index)).find(
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
      } catch {
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
      } catch {
        for (const name of changedNames) {
          index.files[name].syncStatus = "failed";
        }
        await this.store.writeIndex(index);
        failed += changedNames.length;
        uploaded -= uploadedNames.length;
        uploadedNames.length = 0;
        changedNames.length = 0;
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
    return { uploaded, deleted, pending, failed };
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
