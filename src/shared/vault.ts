export type SyncStatus = "synced" | "pending" | "failed";

export interface VaultSnapshotItem {
  name: string;
  ext: string;
  size: number;
  mtime: number;
  syncStatus: SyncStatus;
}

export interface VaultSnapshot {
  items: VaultSnapshotItem[];
  pendingCount: number;
  hasLocalIndex: boolean;
  isInitialized?: boolean;
}

export interface RestoreResult {
  restored: number;
  renamed: number;
}
