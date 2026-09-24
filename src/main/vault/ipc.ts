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
import { VaultSkillsStore } from "./skills-vault";
import type { AddSkillsResult } from "../../shared/vault";
import { getGlobalSkillsRoot } from "./paths";
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
  /** 密库技能集合发生变化（上传/删除/恢复成功）时调用，用于让会话重建技能路径。 */
  onSkillsChanged?: () => void;
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
const defaultSkillsVault = new VaultSkillsStore(defaultStore);
const defaultGlobalSkillsPath = getGlobalSkillsRoot;

/**
 * 渲染层的文件路径是相对 `files/` 模块根的（快照 `items[].path`），
 * 存储 API 要的是根相对路径；两者只差一个模块前缀。
 */
function filesPath(name: string): string {
  return `files/${name}`;
}

export function registerVaultIpc(
  overrides: Partial<VaultIpcDependencies> = {},
): void {
  // 逐字段回落到默认实例（而不是「传了依赖就整体替换」）：注入方可以只覆盖关心的
  // 字段，例如只传 onSkillsChanged。用 ?? 而不是对象展开，是为了让下面的变量保持
  // 非可选类型 —— 展开 Partial 会把每个字段推成 T | undefined。
  const store = overrides.store ?? defaultStore;
  const cloud = overrides.cloud ?? defaultCloud;
  const syncService = overrides.syncService ?? defaultSyncService;
  const restoreService = overrides.restoreService ?? defaultRestoreService;
  const resetService = overrides.resetService ?? defaultResetService;
  const getLocalMek = overrides.getLocalMek ?? loadMek;
  const skillsVault = overrides.skillsVault ?? defaultSkillsVault;
  const globalSkillsPath =
    overrides.globalSkillsPath ?? defaultGlobalSkillsPath;
  const onSkillsChanged = overrides.onSkillsChanged;

  ipcMain.handle("vault.getSnapshot", async (): Promise<VaultSnapshot> => {
    await store.recoverPendingRestore();
    return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
  });

  ipcMain.handle("vault.importFile", async (): Promise<VaultSnapshot> => {
    await assertNoBlockingOperation(store);
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0])
      return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
    await store.importFile(result.filePaths[0]);
    return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
  });

  ipcMain.handle("vault.openFile", async (_event, name: string) => {
    const error = await shell.openPath(store.filePath(filesPath(name)));
    return { error: error || null };
  });

  ipcMain.handle("vault.getFilePath", async (_event, name: string) =>
    store.filePath(filesPath(name)),
  );

  ipcMain.handle("vault.revealFile", async (_event, name: string) => {
    shell.showItemInFolder(store.filePath(filesPath(name)));
    return true;
  });

  ipcMain.handle("vault.exportFile", async (_event, name: string) => {
    const sourcePath = store.filePath(filesPath(name));
    const result = await dialog.showSaveDialog({
      defaultPath: basename(sourcePath),
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await copyFile(sourcePath, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("vault.deleteFile", async (_event, name: string) => {
    await store.deleteFile(filesPath(name));
    return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
  });

  ipcMain.handle("vault.sync", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    const result = await syncService.sync(token);
    if (result.errorCode) throw new Error(result.errorCode);
    return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
  });

  ipcMain.handle(
    "vault.checkRemoteBackup",
    async (_event, token: string): Promise<VaultRemoteStatus> => {
      try {
        const index = await cloud.getIndex(token);
        return { status: index !== null ? "has-backup" : "no-backup" };
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

  ipcMain.handle(
    "vault.addSkillsToVault",
    async (
      _event,
      names: string[],
      confirmSkippedLinks = false,
    ): Promise<AddSkillsResult> => {
      const result = await skillsVault.addSkills(
        names,
        globalSkillsPath(),
        confirmSkippedLinks,
      );
      // 只有真的搬动了才失效会话：它会清掉所有缓存的 SDK 会话。
      if (result.added.length > 0) onSkillsChanged?.();
      return result;
    },
  );

  ipcMain.handle(
    "vault.deleteSkillFromVault",
    async (_event, skillName: string) => {
      await skillsVault.remove(skillName);
      onSkillsChanged?.();
      return getSnapshot(store, skillsVault, getLocalMek, globalSkillsPath());
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
            encodeRemoteIndex({ version: 2, files: {} }, mek),
          );
        }
        await store.writeIndex(index);
        await store.clearOperationMarker();
        return;
      }

      const hasLocalFiles = (await store.scanFiles()).length > 0;
      const remoteIndex =
        token && !hasLocalFiles ? await cloud.getIndex(token) : null;
      if (hasLocalFiles && token) {
        const existingRemoteIndex = await cloud.getIndex(token);
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
   * 单入口恢复。两种「跳过」都要处理：
   * - 本地已有内容 → 跳过（不覆盖用户在本机已有的东西）
   * - 远端没有备份 → 跳过（`VAULT_NO_REMOTE_BACKUP` 不是失败）
   */
  const restoreOnce = async (
    restoreOne: (service: VaultRestoreService) => Promise<RestoreResult>,
  ): Promise<RestoreResult> => {
    const state = await store.readState();
    if (state.hasIndex || state.files.length > 0) {
      return { restored: 0, renamed: 0 };
    }
    try {
      return await restoreOne(restoreService);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === "VAULT_NO_REMOTE_BACKUP"
      ) {
        return { restored: 0, renamed: 0 };
      }
      throw error;
    }
  };

  ipcMain.handle("vault.restoreWithLocalMek", async (_event, token: string) => {
    await assertNoBlockingOperation(store);
    const result = await restoreOnce((service) =>
      service.restoreWithLocalMek(token),
    );
    if (result.restored > 0) onSkillsChanged?.();
    return result;
  });

  ipcMain.handle(
    "vault.restoreWithRecoveryCode",
    async (_event, token: string, recoveryCode: string) => {
      await assertNoBlockingOperation(store);
      const result = await restoreOnce((service) =>
        service.restoreWithRecoveryCode(token, recoveryCode),
      );
      if (result.restored > 0) onSkillsChanged?.();
      return result;
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
  globalSkillsPath: string,
): Promise<VaultSnapshot> {
  const base = await getFileSnapshot(store, getLocalMek);
  await skillsVault.removeStaleStaging();
  const skills = await skillsVault.listVaultSkills();
  const addableSkills =
    await skillsVault.listUploadCandidates(globalSkillsPath);
  const skillsPending = skills.filter(
    (skill) => skill.syncStatus !== "synced",
  ).length;
  return {
    ...base,
    skills,
    addableSkills,
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
      .filter(([name]) => name.startsWith("files/"))
      .map(([name, entry]) => {
        const path = name.slice("files/".length);
        return {
          path,
          ext: extname(path).replace(/^\./, "").toLowerCase(),
          size: entry.size,
          mtime: entry.mtime,
          syncStatus: entry.syncStatus,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
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
