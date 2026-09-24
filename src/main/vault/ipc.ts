import { dialog, ipcMain, shell } from "electron";
import { copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { generateRecoveryCode } from "./recovery";
import {
  initializeNewMek,
  loadMek,
  replaceMek,
  verifyAndStoreMek,
} from "./keychain";
import { encodeRemoteIndex } from "./vault-index";
import { LocalVaultStore } from "./local-store";
import { VaultSkillsStore } from "./skills-vault";
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
  type RestoreResult,
  type VaultBackupUsage,
  type VaultOperationStatus,
  type VaultRemoteStatus,
  type VaultScopeBackup,
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
  skillsVault: VaultSkillsStore;
  globalSkillsPath: () => string;
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
const defaultSkillsVault = new VaultSkillsStore();
const defaultGlobalSkillsPath = (): string =>
  join(homedir(), ".deskwand", "skills");

export function registerVaultIpc(dependencies?: VaultIpcDependencies): void {
  const {
    store,
    cloud,
    syncService,
    restoreService,
    resetService,
    getLocalMek,
    skillsVault,
    globalSkillsPath,
  } = dependencies ?? {
    store: defaultStore,
    cloud: defaultCloud,
    syncService: defaultSyncService,
    restoreService: defaultRestoreService,
    resetService: defaultResetService,
    getLocalMek: loadMek,
    skillsVault: defaultSkillsVault,
    globalSkillsPath: defaultGlobalSkillsPath,
  };

  ipcMain.handle("vault.getSnapshot", async (): Promise<VaultSnapshot> => {
    await store.recoverPendingRestore();
    return getSnapshot(store, skillsVault, getLocalMek);
  });

  ipcMain.handle("vault.importFile", async (): Promise<VaultSnapshot> => {
    await assertNoBlockingOperation(store);
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0])
      return getSnapshot(store, skillsVault, getLocalMek);
    await store.importFile(result.filePaths[0]);
    return getSnapshot(store, skillsVault, getLocalMek);
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
    return getSnapshot(store, skillsVault, getLocalMek);
  });

  ipcMain.handle("vault.sync", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    const result = await syncService.sync(token);
    if (result.errorCode) throw new Error(result.errorCode);
    // 技能 scope 也一起同步。它失败不回滚 files（文件密库成功不该被技能拖垮），
    // 但必须让用户看见 —— 通过返回值的 syncError 透出。
    let syncError: string | undefined;
    try {
      const skillsResult = await skillsVault.syncService.sync(token);
      if (skillsResult.errorCode) syncError = skillsResult.errorCode;
      else if (skillsResult.failed > 0) syncError = "VAULT_SKILL_SYNC_FAILED";
    } catch (error: unknown) {
      syncError =
        error instanceof Error ? error.message : "VAULT_SKILL_SYNC_FAILED";
    }
    const snapshot = await getSnapshot(store, skillsVault, getLocalMek);
    return { ...snapshot, syncError };
  });

  ipcMain.handle(
    "vault.checkRemoteBackup",
    async (_event, token: string): Promise<VaultRemoteStatus> => {
      const read = async (
        scope: "files" | "skills",
      ): Promise<VaultScopeBackup> => {
        try {
          const index = await cloud.getIndex(token, scope);
          return { hasBackup: index !== null };
        } catch (error: unknown) {
          const classified = classifyRemoteBackupError(error);
          return {
            hasBackup: false,
            errorCode: classified.errorCode ?? "VAULT_CLOUD_ERROR",
          };
        }
      };
      const [files, skills] = await Promise.all([
        read("files"),
        read("skills"),
      ]);
      const errorCode = files.errorCode ?? skills.errorCode;
      if (errorCode) {
        return { status: "error", errorCode, scopes: { files, skills } };
      }
      return {
        status:
          files.hasBackup || skills.hasBackup ? "has-backup" : "no-backup",
        scopes: { files, skills },
      };
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

  ipcMain.handle(
    "vault.getSkillUploadCandidates",
    async (): Promise<string[]> =>
      skillsVault.listUploadCandidates(globalSkillsPath()),
  );

  ipcMain.handle(
    "vault.preflightSkillUpload",
    async (_event, skillName: string, availableBytes: number | null = null) =>
      skillsVault.preflight(skillName, globalSkillsPath(), availableBytes),
  );

  ipcMain.handle("vault.uploadSkill", async (_event, skillName: string) => {
    await skillsVault.upload(skillName, globalSkillsPath());
    return getSnapshot(store, skillsVault, getLocalMek);
  });

  ipcMain.handle(
    "vault.deleteSkillFromVault",
    async (_event, skillName: string) => {
      await skillsVault.remove(skillName);
      return getSnapshot(store, skillsVault, getLocalMek);
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

  /**
   * 逐 scope 恢复，两种「跳过」都要处理，否则一个 scope 会拖垮另一个：
   * - 该 scope 已有本地数据 → 跳过（不覆盖用户在本机已有的东西）
   * - 该 scope 没有远端备份 → 跳过（`VAULT_NO_REMOTE_BACKUP` 不是失败）
   *
   * 少了第二种时，「只有 files 备份」的老用户在新设备上会看到恢复失败红条，
   * 而「只有 skills 备份」的设备则永远恢复不了。
   */
  const restoreAllScopes = async (
    restoreOne: (
      target: LocalVaultStore,
      service: VaultRestoreService,
    ) => Promise<RestoreResult>,
  ): Promise<RestoreResult> => {
    let restored = 0;
    let renamed = 0;
    const targets: Array<[LocalVaultStore, VaultRestoreService]> = [
      [store, restoreService],
      [skillsVault.store, skillsVault.restoreService],
    ];
    for (const [targetStore, targetService] of targets) {
      const state = await targetStore.readState();
      if (state.hasIndex || state.files.length > 0) continue;
      try {
        const result = await restoreOne(targetStore, targetService);
        restored += result.restored;
        renamed += result.renamed;
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message === "VAULT_NO_REMOTE_BACKUP"
        ) {
          continue;
        }
        throw error;
      }
    }
    return { restored, renamed };
  };

  ipcMain.handle("vault.restoreWithLocalMek", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    return restoreAllScopes((_target, service) =>
      service.restoreWithLocalMek(token),
    );
  });

  ipcMain.handle(
    "vault.restoreWithRecoveryCode",
    async (_event, token: string, recoveryCode: string) => {
      await assertNoBlockingOperation(store);
      // 恢复码只用于派生 MEK：两个 scope 共用同一把，VaultRestoreService 在
      // MEK 已存在时会跳过落盘，因此重复调用是安全的。
      return restoreAllScopes((_target, service) =>
        service.restoreWithRecoveryCode(token, recoveryCode),
      );
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

/**
 * 统一快照：files 的条目与 skills 的技能列表一次返回，渲染层两个 tab 共用。
 * 技能列表由主进程聚合（`listVaultSkills`），渲染层不需要额外往返。
 */
async function getSnapshot(
  store: LocalVaultStore,
  skillsVault: VaultSkillsStore,
  getLocalMek: () => Buffer | null,
): Promise<VaultSnapshot> {
  const base = await getFileSnapshot(store, getLocalMek);
  await skillsVault.removeStaleStaging();
  const skills = await skillsVault.listVaultSkills();
  const skillsPending = skills.filter(
    (skill) => skill.syncStatus !== "synced",
  ).length;
  return {
    ...base,
    skills,
    // 「待同步」必须把技能 scope 算进来：否则只上传过技能的用户点同步会看到
    // 「已是最新」，而技能其实一份都没到云端。
    pendingCount: base.pendingCount + skillsPending,
  };
}

async function getFileSnapshot(
  store: LocalVaultStore,
  getLocalMek: () => Buffer | null,
): Promise<Omit<VaultSnapshot, "skills">> {
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
