import { dialog, ipcMain, shell } from "electron";
import { copyFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { generateRecoveryCode } from "./recovery";
import {
  initializeNewMek,
  loadMek,
  replaceMek,
  verifyAndStoreMek,
} from "./keychain";
import { encodeRemoteIndex } from "./vault-index";
import { LocalVaultStore } from "./local-store";
import {
  FetchVaultCloudClient,
  VaultCloudError,
  type VaultCloudClient,
} from "./cloud-client";
import {
  VaultRestoreService,
  VaultResetService,
  VaultSyncService,
  type VaultResetPreparation,
  type VaultResetResult,
} from "./sync";
import {
  type VaultBackupUsage,
  type VaultOperationStatus,
  type VaultRemoteStatus,
  type VaultSnapshot,
} from "../../shared/vault";
import { log } from "../utils/logger";

export interface VaultIpcDependencies {
  store: LocalVaultStore;
  cloud: VaultCloudClient;
  syncService: VaultSyncService;
  restoreService: VaultRestoreService;
  resetService: VaultResetService;
  getLocalMek: () => Buffer | null;
}

export function classifyRemoteBackupError(error: unknown): VaultRemoteStatus {
  if (error instanceof VaultCloudError) {
    return { status: "error", errorCode: error.message };
  }
  if (error instanceof Error) {
    return { status: "error", errorCode: error.message };
  }
  return { status: "error", errorCode: "VAULT_CLOUD_ERROR" };
}

const defaultStore = new LocalVaultStore();
const defaultCloud = new FetchVaultCloudClient();
const defaultSyncService = new VaultSyncService(defaultStore, defaultCloud);
const defaultRestoreService = new VaultRestoreService(
  defaultStore,
  defaultCloud,
);
const defaultResetService = new VaultResetService(defaultStore, defaultCloud);

export function registerVaultIpc(dependencies?: VaultIpcDependencies): void {
  const {
    store,
    cloud,
    syncService,
    restoreService,
    resetService,
    getLocalMek,
  } = dependencies ?? {
    store: defaultStore,
    cloud: defaultCloud,
    syncService: defaultSyncService,
    restoreService: defaultRestoreService,
    resetService: defaultResetService,
    getLocalMek: loadMek,
  };

  ipcMain.handle("vault.getSnapshot", async (): Promise<VaultSnapshot> => {
    await store.recoverPendingRestore();
    return getSnapshot(store, getLocalMek);
  });

  ipcMain.handle("vault.importFile", async (): Promise<VaultSnapshot> => {
    await assertNoBlockingOperation(store);
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0])
      return getSnapshot(store, getLocalMek);
    await store.importFile(result.filePaths[0]);
    return getSnapshot(store, getLocalMek);
  });

  ipcMain.handle("vault.openFile", async (_event, name: string) => {
    const error = await shell.openPath(store.filePath(name));
    return { error: error || null };
  });

  ipcMain.handle("vault.getFilePath", async (_event, name: string) =>
    store.filePath(name),
  );

  ipcMain.handle("vault.revealFile", async (_event, name: string) => {
    shell.showItemInFolder(store.filePath(name));
    return true;
  });

  ipcMain.handle("vault.exportFile", async (_event, name: string) => {
    const sourcePath = store.filePath(name);
    const result = await dialog.showSaveDialog({
      defaultPath: basename(sourcePath),
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await copyFile(sourcePath, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("vault.deleteFile", async (_event, name: string) => {
    await store.deleteFile(name);
    return getSnapshot(store, getLocalMek);
  });

  ipcMain.handle("vault.sync", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    const result = await syncService.sync(token);
    if (result.errorCode) throw new Error(result.errorCode);
    return getSnapshot(store, getLocalMek);
  });

  ipcMain.handle(
    "vault.checkRemoteBackup",
    async (_event, token: string): Promise<VaultRemoteStatus> => {
      try {
        const index = await cloud.getIndex(token, "files");
        return index === null
          ? { status: "no-backup" }
          : { status: "has-backup" };
      } catch (error: unknown) {
        return classifyRemoteBackupError(error);
      }
    },
  );

  ipcMain.handle(
    "vault.getBackupUsage",
    async (_event, token: string | null): Promise<VaultBackupUsage | null> => {
      if (!token) return null;
      try {
        return (await cloud.getUsage?.(token)) ?? null;
      } catch (error: unknown) {
        // Usage is advisory: a failed lookup must never break the local snapshot.
        log("[vault] failed to read cloud usage", error);
        return null;
      }
    },
  );

  ipcMain.handle("vault.generateRecoveryCode", () => generateRecoveryCode());

  ipcMain.handle(
    "vault.initialize",
    async (_event, token: string | null, recoveryCode: string) => {
      const marker = await store.readOperationMarker();
      if (
        marker &&
        marker.kind === "reset" &&
        marker.state === "awaiting-recovery-code"
      ) {
        // A reset may have been interrupted after the old backup was removed.
        // Complete it using the newly confirmed recovery code, and only clear
        // the marker after the replacement index is durable.
        replaceMek(recoveryCode);
        const mek = loadMek();
        if (!mek) throw new Error("VAULT_KEYCHAIN_UNAVAILABLE");
        const index = await store.reconcile(await store.readIndex());
        for (const entry of Object.values(index.files)) {
          entry.objectId = null;
          entry.objectHash = null;
          entry.syncStatus = "pending";
        }
        index.pendingDeletes = [];
        if (token) {
          await cloud.putIndex(
            token,
            "files",
            encodeRemoteIndex({ version: 1, files: {} }, mek),
          );
        }
        await store.writeIndex(index);
        await store.clearOperationMarker();
        return;
      }

      const hasLocalFiles = (await store.scanFiles()).length > 0;
      const remoteIndex =
        token && !hasLocalFiles ? await cloud.getIndex(token, "files") : null;
      if (hasLocalFiles && token) {
        const existingRemoteIndex = await cloud.getIndex(token, "files");
        if (existingRemoteIndex) {
          throw new Error("VAULT_REMOTE_BACKUP_EXISTS");
        }
      }
      if (remoteIndex) verifyAndStoreMek(recoveryCode, remoteIndex);
      else initializeNewMek(recoveryCode);
      const index = await store.reconcile(await store.readIndex());
      await store.writeIndex(index);
    },
  );

  ipcMain.handle("vault.restoreWithLocalMek", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    if ((await store.hasIndex()) || (await store.scanFiles()).length > 0) {
      throw new Error("VAULT_LOCAL_INDEX_EXISTS");
    }
    return restoreService.restoreWithLocalMek(token);
  });

  ipcMain.handle(
    "vault.restoreWithRecoveryCode",
    async (_event, token: string, recoveryCode: string) => {
      await assertNoBlockingOperation(store);
      if ((await store.hasIndex()) || (await store.scanFiles()).length > 0) {
        throw new Error("VAULT_LOCAL_INDEX_EXISTS");
      }
      return restoreService.restoreWithRecoveryCode(token, recoveryCode);
    },
  );

  ipcMain.handle(
    "vault.beginDiscardAndReinitialize",
    async (_event, token: string): Promise<VaultResetPreparation> => {
      return resetService.beginDiscardAndReinitialize(token);
    },
  );

  ipcMain.handle(
    "vault.completeDiscardAndReinitialize",
    async (
      _event,
      token: string,
      recoveryCode: string,
    ): Promise<VaultResetResult> => {
      return resetService.completeDiscardAndReinitialize(token, recoveryCode);
    },
  );

  ipcMain.handle(
    "vault.discardRemoteBackupAndStart",
    async (_event, token: string): Promise<VaultResetResult> => {
      return resetService.discardWithoutLocalKey(token);
    },
  );
}

async function assertNoBlockingOperation(
  store: LocalVaultStore,
): Promise<void> {
  const marker = await store.readOperationMarker();
  if (!marker) return;
  if (marker.kind === "reset") throw new Error("VAULT_RESET_IN_PROGRESS");
  throw new Error("VAULT_RESTORE_IN_PROGRESS");
}

async function getSnapshot(
  store: LocalVaultStore,
  getLocalMek: () => Buffer | null,
): Promise<VaultSnapshot> {
  const hasLocalIndex = await store.hasIndex();
  const files = await store.scanFiles();
  const hasLocalFiles = files.length > 0;
  const hasLocalMek = getLocalMek() !== null;
  const operation = await store.readOperationMarker();
  const operationStatus: VaultOperationStatus =
    operation?.state === "committing"
      ? "restoring"
      : (operation?.state ?? "idle");
  const index = await store.reconcile(await store.readIndex());
  if (hasLocalIndex || hasLocalFiles) await store.writeIndex(index);
  const usedBytes = await store.getUsageBytes(index);
  return {
    items: Object.entries(index.files)
      .map(([name, entry]) => ({
        name,
        ext: extname(name).replace(/^\./, "").toLowerCase(),
        size: entry.size,
        mtime: entry.mtime,
        syncStatus: entry.syncStatus,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    pendingCount:
      Object.values(index.files).filter(
        (entry) => entry.syncStatus !== "synced",
      ).length + index.pendingDeletes.length,
    hasLocalIndex,
    hasLocalFiles,
    hasLocalMek,
    operationStatus,
    usedBytes,
  };
}
