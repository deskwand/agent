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

/** 「可加入密库」的本地技能：主进程算好放进快照，渲染层直接用。 */
export interface VaultAddableSkill {
  name: string;
  description: string;
}

/** 批量加入密库的结果。 */
export interface AddSkillsResult {
  /** 未确认且所选技能里含符号链接时返回；此时 added/failed 均为空、磁盘不动。 */
  needsConfirmation?: Array<{ name: string; symlinkedEntries: string[] }>;
  added: string[];
  failed: Array<{ name: string; reason: string }>;
  /**
   * 搬移成功但索引写入失败时的错误。文件已经在密库里，索引是派生视图（下一次
   * reconcile 会补上），所以这不算整批失败 —— 但也不能当成没发生。
   */
  indexError?: string;
}

export interface VaultSnapshot {
  items: VaultSnapshotItem[];
  /**
   * 技能密库的技能列表（主进程聚合，技能 tab 直接渲染）。
   * 可选：只有 `vault.getSnapshot` 会填充它，测试替身仍可省。
   */
  skills?: VaultSkillEntry[];
  /** 可加入密库的本地技能（真目录、有 SKILL.md、kebab 名、尚未在密库）。 */
  addableSkills?: VaultAddableSkill[];
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
