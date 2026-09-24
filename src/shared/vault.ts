export type SyncStatus = "synced" | "pending" | "failed";

export interface VaultSnapshotItem {
  name: string;
  ext: string;
  size: number;
  mtime: number;
  syncStatus: SyncStatus;
}

export type RemoteBackupStatus =
  | "unknown"
  | "no-backup"
  | "has-backup"
  | "error";

export type VaultOperationStatus =
  | "idle"
  | "restoring"
  | "resetting"
  | "awaiting-recovery-code";

export interface VaultSkillEntry {
  name: string;
  fileCount: number;
  totalBytes: number;
  syncStatus: SyncStatus;
}

export interface VaultSnapshot {
  items: VaultSnapshotItem[];
  /**
   * 技能密库的技能列表（主进程聚合，技能 tab 直接渲染）。
   * 可选：只有 `vault.getSnapshot` 会填充它，测试替身仍可省。
   */
  skills?: VaultSkillEntry[];
  pendingCount: number;
  hasLocalIndex: boolean;
  hasLocalFiles: boolean;
  hasLocalMek: boolean;
  operationStatus: VaultOperationStatus;
  usedBytes: number;
  /** 同步时技能 scope 失败的提示（files 的失败仍抛错，不进这里）。 */
  syncError?: string;
}

/** 单个 scope 的远端备份状态。 */
/** 上传技能前的体检结果：只报告不拦截。 */
export interface VaultSkillPreflight {
  skillName: string;
  fileCount: number;
  totalBytes: number;
  oversizedFiles: Array<{ relativePath: string; size: number }>;
  symlinkedEntries: string[];
  quotaShortfallBytes: number | null;
}

export interface VaultScopeBackup {
  hasBackup: boolean;
  errorCode?: string;
}

export interface VaultRemoteStatus {
  status: Exclude<RemoteBackupStatus, "unknown">;
  errorCode?: string;
  /**
   * 逐 scope 的细节。`status` 的语义保持不变（no-backup = 两个 scope 都没有），
   * 因此既有的模式机与测试替身不受影响。
   */
  scopes?: { files: VaultScopeBackup; skills: VaultScopeBackup };
}

export interface RestoreResult {
  restored: number;
  renamed: number;
}

export interface VaultResetPreparation {
  recoveryCode: string;
  preservedLocalFiles: number;
}

export interface VaultResetResult {
  deletedObjects: number;
  preservedLocalFiles: number;
}

export type VaultErrorCode =
  | `VAULT_CLOUD_HTTP_${number}`
  | "VAULT_RESET_FAILED"
  | "VAULT_RESET_IN_PROGRESS"
  | "VAULT_RESTORE_IN_PROGRESS"
  | "VAULT_KEY_REQUIRED"
  | "VAULT_KEYCHAIN_UNAVAILABLE"
  | "VAULT_LOCAL_DISK_FULL"
  | "VAULT_QUOTA_EXCEEDED";

export interface VaultBackupUsage {
  usedBytes: number;
  quotaBytes: number | null;
}
