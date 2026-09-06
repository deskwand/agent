import { deriveMek } from "./crypto";
import { packFile, unpack } from "./objects";
import { loadMek, verifyAndStoreMek } from "./keychain";
import {
  decodeRemoteIndex,
  encodeRemoteIndex,
  toRemoteIndex,
} from "./vault-index";
import {
  isReservedVaultName,
  type LocalVaultEntry,
  type LocalVaultStore,
} from "./local-store";
import { VaultCloudError, type VaultCloudClient } from "./cloud-client";
import type { RestoreResult } from "../../shared/vault";

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
  ) {}

  async restore(token: string, recoveryCode: string): Promise<RestoreResult> {
    const encryptedIndex = await this.cloud.getIndex(token);
    if (!encryptedIndex) throw new Error("VAULT_NO_REMOTE_BACKUP");

    const mek = deriveMek(recoveryCode);
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

    const existingNames = new Set(
      (await this.store.scanFiles()).map((file) => file.name),
    );
    const staged: Array<{
      originalName: string;
      name: string;
      entry: (typeof remote.files)[string];
      contents: Buffer;
    }> = [];
    let renamed = 0;
    for (const [originalName, entry] of Object.entries(remote.files)) {
      if (isReservedVaultName(originalName)) continue;
      const name = uniqueRestoreName(originalName, existingNames);
      if (name !== originalName) renamed += 1;
      const payload = await this.cloud.getObject(token, entry.objectId);
      staged.push({
        originalName,
        name,
        entry,
        contents: await unpack(payload, mek),
      });
      existingNames.add(name);
    }

    verifyAndStoreMek(recoveryCode, encryptedIndex);
    const restoredEntries: Record<string, LocalVaultEntry> = {};
    const writtenNames: string[] = [];
    try {
      for (const item of staged) {
        await this.store.restoreFile(item.name, item.contents);
        writtenNames.push(item.name);
        restoredEntries[item.name] = {
          ...item.entry,
          objectHash: item.entry.hash,
          syncStatus: "synced",
        };
      }

      const localIndex = await this.store.readIndex();
      localIndex.files = {
        ...localIndex.files,
        ...restoredEntries,
      };
      await this.store.writeIndex(localIndex);
    } catch (error: unknown) {
      await Promise.all(
        writtenNames.map((name) => this.store.removeFile(name)),
      );
      throw error;
    }
    return { restored: staged.length, renamed };
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
