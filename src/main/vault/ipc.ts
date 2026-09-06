import { dialog, ipcMain, shell } from "electron";
import { copyFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { generateRecoveryCode } from "./recovery";
import { hasStoredMek, initializeNewMek, verifyAndStoreMek } from "./keychain";
import { LocalVaultStore } from "./local-store";
import { FetchVaultCloudClient } from "./cloud-client";
import { VaultRestoreService, VaultSyncService } from "./sync";
import type { VaultSnapshot } from "../../shared/vault";

const store = new LocalVaultStore();
const cloud = new FetchVaultCloudClient();
const syncService = new VaultSyncService(store, cloud);
const restoreService = new VaultRestoreService(store, cloud);

export function registerVaultIpc(): void {
  ipcMain.handle(
    "vault.getSnapshot",
    async (): Promise<VaultSnapshot> => getSnapshot(),
  );

  ipcMain.handle("vault.importFile", async (): Promise<VaultSnapshot> => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return getSnapshot();
    await store.importFile(result.filePaths[0]);
    return getSnapshot();
  });

  ipcMain.handle("vault.openFile", async (_event, name: string) => {
    const error = await shell.openPath(store.filePath(name));
    return { error: error || null };
  });

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
    return getSnapshot();
  });

  ipcMain.handle("vault.sync", async (_event, token: string) => {
    await syncService.sync(token);
    return getSnapshot();
  });

  ipcMain.handle("vault.checkRemoteBackup", async (_event, token: string) => {
    return (await cloud.getIndex(token)) !== null;
  });

  ipcMain.handle("vault.generateRecoveryCode", () => generateRecoveryCode());

  ipcMain.handle(
    "vault.initialize",
    async (_event, token: string | null, recoveryCode: string) => {
      const remoteIndex = token ? await cloud.getIndex(token) : null;
      if (remoteIndex) verifyAndStoreMek(recoveryCode, remoteIndex);
      else initializeNewMek(recoveryCode);
    },
  );

  ipcMain.handle(
    "vault.restore",
    async (_event, token: string, recoveryCode: string) => {
      if (await store.hasIndex()) {
        throw new Error("VAULT_LOCAL_INDEX_EXISTS");
      }
      return restoreService.restore(token, recoveryCode);
    },
  );
}

async function getSnapshot(): Promise<VaultSnapshot> {
  const hasLocalIndex = await store.hasIndex();
  const index = await store.reconcile(await store.readIndex());
  if (hasLocalIndex) await store.writeIndex(index);
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
    isInitialized: hasStoredMek(),
  };
}
