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

export interface VaultSnapshot {
  items: VaultSnapshotItem[];
  pendingCount: number;
  hasLocalIndex: boolean;
  hasLocalFiles: boolean;
  hasLocalMek: boolean;
  operationStatus: VaultOperationStatus;
  usedBytes: number;
}

export interface VaultRemoteStatus {
  status: Exclude<RemoteBackupStatus, "unknown">;
  errorCode?: string;
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
