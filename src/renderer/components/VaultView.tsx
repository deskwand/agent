import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { isBrowserOpenableExt, isPreviewableExt } from "../utils/file-preview";
import { openFilePathInBrowser } from "../utils/open-in-browser";
import { getFileKind } from "../utils/file-types";
import { FileTypeIcon } from "./file-type-icon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DANGER_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_LABEL_CLASS,
  MENU_PANEL_PADDED_CLASS,
} from "./menu-styles";
import type {
  SyncStatus,
  VaultBackupUsage,
  VaultRemoteStatus,
  VaultSnapshot,
  VaultSnapshotItem,
} from "../../shared/vault";

type Filter = "files" | "skills" | "sessions";
type SyncFeedback = "idle" | "syncing" | "success" | "error";
type PendingConfirmation =
  | { kind: "delete"; item: VaultSnapshotItem }
  | { kind: "delete-skill"; name: string }
  | { kind: "discard-new-device" }
  | { kind: "reset-existing" };
type EmptyVaultMode =
  | "loading"
  | "normal"
  | "local-files"
  | "first-setup"
  | "auto-restoring"
  | "recovery-input"
  | "empty-ready"
  | "restore-error"
  | "remote-error"
  | "resetting";

const FILTERS: Filter[] = ["files", "skills", "sessions"];

const SYNC_LABEL_DELAY_MS = 250;

function statusText(status: SyncStatus, t: (key: string) => string): string {
  if (status === "synced") return t("vault.status.synced");
  if (status === "failed") return t("vault.status.failed");
  return t("vault.status.pending");
}

/**
 * 批量加入密库的失败原因。已知码复用 errorText 的分支；其余（EACCES / ENOSPC 一类
 * 本地错误）落到「加入失败」—— errorText 的兜底是「云端同步失败，本地文件未受影响」，
 * 而这次操作根本没碰云端，用它会误导。
 */
function skillAddErrorText(
  reason: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const known = [
    "VAULT_SKILL_NAME_TAKEN",
    "VAULT_INVALID_SKILL_NAME",
    "VAULT_SKILL_UPLOAD_FAILED",
    "VAULT_UNSUPPORTED_PATH",
  ];
  if (known.some((prefix) => reason.startsWith(prefix))) {
    return errorText(new Error(reason), t);
  }
  return t("vault.skills.error.addFailed");
}

function errorText(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!(error instanceof Error)) return t("vault.error.localOperation");
  const message = error.message;
  if (message === "VAULT_FILE_TOO_LARGE") return t("vault.error.fileTooLarge");
  if (message.startsWith("VAULT_INVALID_SKILL_NAME")) {
    return t("vault.skills.error.invalidName");
  }
  if (message.startsWith("VAULT_SKILL_NAME_TAKEN")) {
    return t("vault.skills.error.nameTaken");
  }
  if (message.startsWith("VAULT_SKILL_NOT_SYNCED")) {
    return t("vault.skills.error.notSynced");
  }
  if (message.startsWith("VAULT_SKILL_UPLOAD_FAILED")) {
    return t("vault.skills.error.uploadFailed");
  }
  if (message.startsWith("VAULT_UNSUPPORTED_PATH")) {
    return t("vault.skills.error.unsupportedPath", {
      name: message.slice("VAULT_UNSUPPORTED_PATH:".length),
    });
  }
  if (message === "VAULT_LOCAL_DISK_FULL") return t("vault.error.diskFull");
  if (message === "VAULT_QUOTA_EXCEEDED")
    return t("vault.error.cloudQuotaExceeded");
  if (message === "VAULT_KEY_REQUIRED") return t("vault.error.setupRequired");
  if (message === "VAULT_RECOVERY_MISMATCH")
    return t("vault.error.recoveryMismatch");
  if (message === "VAULT_INVALID_RECOVERY_CODE")
    return t("vault.error.invalidRecoveryCode");
  if (message === "VAULT_ALREADY_INITIALIZED")
    return t("vault.error.alreadyInitialized");
  if (message === "VAULT_KEYCHAIN_UNAVAILABLE")
    return t("vault.error.keychainUnavailable");
  if (message === "VAULT_NO_REMOTE_BACKUP")
    return t("vault.error.noRemoteBackup");
  if (message === "VAULT_LOCAL_INDEX_EXISTS")
    return t("vault.error.localIndexExists");
  if (message === "VAULT_LOCAL_FILES_EXIST")
    return t("vault.error.localFilesExist");
  if (message === "VAULT_REMOTE_BACKUP_EXISTS")
    return t("vault.reset.localFilesConflict");
  if (message === "VAULT_CLOUD_HTTP_401")
    return t("vault.error.sessionExpired");
  if (message === "VAULT_CLOUD_HTTP_403")
    return t("vault.error.permissionDenied");
  if (message.startsWith("VAULT_CLOUD_HTTP_5"))
    return t("vault.error.serverError");
  if (message.startsWith("VAULT_CLOUD_HTTP_"))
    return t("vault.error.syncFailed");
  if (message === "VAULT_RESET_FAILED") return t("vault.error.resetFailed");
  if (message === "VAULT_RESET_IN_PROGRESS")
    return t("vault.error.resetInProgress");
  if (message === "VAULT_RESTORE_IN_PROGRESS")
    return t("vault.error.restoreInProgress");
  return t("vault.error.syncFailed");
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function describeMode(
  snapshot: VaultSnapshot | null,
  remoteStatus: VaultRemoteStatus | null,
  restoreFailed: boolean,
): EmptyVaultMode {
  if (!snapshot) return "loading";
  if (snapshot.operationStatus === "resetting") return "resetting";
  if (snapshot.operationStatus === "awaiting-recovery-code") {
    return "first-setup";
  }
  if (snapshot.hasLocalIndex) return "normal";
  if (snapshot.hasLocalFiles) return "local-files";
  if (restoreFailed) return "restore-error";
  if (!remoteStatus) return "loading";
  if (remoteStatus.status === "error") return "remote-error";
  if (remoteStatus.status === "has-backup") {
    return snapshot.hasLocalMek ? "auto-restoring" : "recovery-input";
  }
  return snapshot.hasLocalMek ? "empty-ready" : "first-setup";
}

export function VaultView(): JSX.Element {
  const { t } = useTranslation();
  const token = useAppStore((state) => state.cloudConfig?.token ?? null);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const openPreview = useAppStore((state) => state.openPreview);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [backupUsage, setBackupUsage] = useState<VaultBackupUsage | null>(null);
  const [filter, setFilter] = useState<Filter>("files");
  const [remoteStatus, setRemoteStatus] = useState<VaultRemoteStatus | null>(
    null,
  );
  const [remoteStatusRetry, setRemoteStatusRetry] = useState(0);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback>("idle");
  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState<string | null>(
    null,
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(
    () => new Set(),
  );
  const [skillQuery, setSkillQuery] = useState("");
  const [skillAddResult, setSkillAddResult] = useState<string | null>(null);
  const [pendingLinkConfirm, setPendingLinkConfirm] = useState<Array<{
    name: string;
    symlinkedEntries: string[];
  }> | null>(null);
  const [advancedMenuOpen, setAdvancedMenuOpen] = useState(false);
  const syncFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncLabelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedMenuBoundaryRef = useRef<HTMLDivElement | null>(null);
  const advancedMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const advancedResetRef = useRef<HTMLButtonElement | null>(null);
  const autoRestoreFired = useRef(false);
  const setupGenerated = useRef(false);

  useEffect(() => {
    return () => {
      if (syncFeedbackTimer.current) clearTimeout(syncFeedbackTimer.current);
      if (syncLabelTimer.current) clearTimeout(syncLabelTimer.current);
    };
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      setSnapshot(await window.electronAPI.vault.getSnapshot());
    } catch (loadError: unknown) {
      setError(errorText(loadError, t));
    }
  }, [t]);

  const usageSeq = useRef(0);

  const loadBackupUsage = useCallback(async () => {
    const seq = (usageSeq.current += 1);
    try {
      const usage = await window.electronAPI.vault.getBackupUsage(token);
      if (seq === usageSeq.current) setBackupUsage(usage);
    } catch {
      if (seq === usageSeq.current) setBackupUsage(null);
    }
  }, [token]);

  useEffect(() => {
    void loadSnapshot();
    void loadBackupUsage();
  }, [loadSnapshot, loadBackupUsage]);

  useEffect(() => {
    if (
      !snapshot ||
      snapshot.hasLocalIndex ||
      !token ||
      (snapshot.hasLocalFiles && snapshot.hasLocalMek)
    ) {
      setRemoteStatus(null);
      return;
    }
    let canceled = false;
    void window.electronAPI.vault
      .checkRemoteBackup(token)
      .then((status) => {
        if (!canceled) setRemoteStatus(status);
      })
      .catch(() => {
        if (!canceled)
          setRemoteStatus({ status: "error", errorCode: "VAULT_CLOUD_ERROR" });
      });
    return () => {
      canceled = true;
    };
  }, [snapshot, token, remoteStatusRetry]);

  const mode = useMemo(
    () => describeMode(snapshot, remoteStatus, restoreFailed),
    [snapshot, remoteStatus, restoreFailed],
  );

  const visibleItems = useMemo(() => {
    if (filter !== "files") return [];
    return snapshot?.items ?? [];
  }, [filter, snapshot?.items]);

  const runAction = useCallback(
    async (action: () => Promise<VaultSnapshot | unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (result && typeof result === "object" && "items" in result) {
          setSnapshot(result as VaultSnapshot);
        } else {
          await loadSnapshot();
        }
      } catch (actionError: unknown) {
        setError(errorText(actionError, t));
      } finally {
        setBusy(false);
        void loadBackupUsage();
      }
    },
    [loadBackupUsage, loadSnapshot, t],
  );

  const handleUpload = useCallback(() => {
    void runAction(() => window.electronAPI.vault.importFile());
  }, [runAction]);

  const handleAutoRestore = useCallback(async () => {
    if (!token) return;
    autoRestoreFired.current = true;
    setRestoreFailed(false);
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.vault.restoreWithLocalMek(token);
      setSnapshot(await window.electronAPI.vault.getSnapshot());
    } catch (restoreError: unknown) {
      setRestoreFailed(true);
      setError(errorText(restoreError, t));
    } finally {
      setBusy(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (mode !== "auto-restoring" || autoRestoreFired.current) return;
    void handleAutoRestore();
  }, [mode, handleAutoRestore]);

  const handleGenerateRecoveryCode = useCallback(async () => {
    setError(null);
    if (recoveryCode) {
      setRecoveryConfirmed(false);
      return;
    }
    try {
      setRecoveryCode(await window.electronAPI.vault.generateRecoveryCode());
      setRecoveryConfirmed(false);
    } catch (setupError: unknown) {
      setError(errorText(setupError, t));
    }
  }, [recoveryCode, t]);

  useEffect(() => {
    const needsSetup =
      mode === "first-setup" ||
      (mode === "local-files" && snapshot !== null && !snapshot.hasLocalMek);
    if (!needsSetup || setupGenerated.current) return;
    setupGenerated.current = true;
    void handleGenerateRecoveryCode();
  }, [mode, snapshot, handleGenerateRecoveryCode]);

  const handleSync = async () => {
    if (syncFeedbackTimer.current) {
      clearTimeout(syncFeedbackTimer.current);
      syncFeedbackTimer.current = null;
    }
    if (syncLabelTimer.current) {
      clearTimeout(syncLabelTimer.current);
      syncLabelTimer.current = null;
    }
    setSyncFeedback("idle");
    setSyncFeedbackMessage(null);

    if (!token) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(t("vault.error.loginRequired"));
      return;
    }

    const pendingBefore = snapshot?.pendingCount ?? null;
    setBusy(true);
    setError(null);
    syncLabelTimer.current = setTimeout(() => {
      syncLabelTimer.current = null;
      setSyncFeedback("syncing");
    }, SYNC_LABEL_DELAY_MS);

    let nextSnapshot: VaultSnapshot | null = null;
    let syncFailure: string | null = null;
    try {
      nextSnapshot = await window.electronAPI.vault.sync(token);
    } catch (syncError: unknown) {
      syncFailure = errorText(syncError, t);
    } finally {
      if (syncLabelTimer.current) {
        clearTimeout(syncLabelTimer.current);
        syncLabelTimer.current = null;
      }
      setBusy(false);
      void loadBackupUsage();
    }

    if (syncFailure || !nextSnapshot) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(syncFailure ?? t("vault.error.syncFailed"));
      return;
    }
    setSnapshot(nextSnapshot);
    // 技能 scope 失败时 files 可能已经同步成功：说清是哪一半没上去，
    // 否则用户看到「同步失败」会以为文件也没备份。
    if (nextSnapshot.syncError) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(t("vault.syncFailedSkills"));
      return;
    }
    if (nextSnapshot.pendingCount > 0) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(t("vault.error.syncFailed"));
      return;
    }
    setSyncFeedback("success");
    setSyncFeedbackMessage(
      pendingBefore === 0 ? t("vault.alreadyLatest") : t("vault.syncComplete"),
    );
    syncFeedbackTimer.current = setTimeout(() => {
      setSyncFeedback("idle");
      setSyncFeedbackMessage(null);
      syncFeedbackTimer.current = null;
    }, 3000);
  };

  const handleInitialize = async () => {
    if (!recoveryCode || !recoveryConfirmed) return;
    await runAction(async () => {
      if (resetPending) {
        if (!token) throw new Error("VAULT_KEY_REQUIRED");
        await window.electronAPI.vault.completeDiscardAndReinitialize(
          token,
          recoveryCode,
        );
      } else {
        await window.electronAPI.vault.initialize(token, recoveryCode);
      }
      setResetPending(false);
      setRecoveryCode(null);
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const handleRestore = () => {
    if (!token || !restoreCode) return;
    void runAction(async () => {
      await window.electronAPI.vault.restoreWithRecoveryCode(
        token,
        restoreCode,
      );
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const retryAutoRestore = () => {
    setRestoreFailed(false);
    autoRestoreFired.current = false;
    void handleAutoRestore();
  };

  const handleDiscardAndRestart = () => {
    if (token) setPendingConfirmation({ kind: "discard-new-device" });
  };

  const retryReset = () => {
    if (!token) return;
    void runAction(async () => {
      if (snapshot?.hasLocalMek) {
        const preparation =
          await window.electronAPI.vault.beginDiscardAndReinitialize(token);
        setRecoveryCode(preparation.recoveryCode);
        setRecoveryConfirmed(false);
        setResetPending(true);
      } else {
        await window.electronAPI.vault.discardRemoteBackupAndStart(token);
      }
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const handleBeginReset = () => {
    if (token) setPendingConfirmation({ kind: "reset-existing" });
  };

  const advancedResetAvailable =
    Boolean(token) &&
    mode !== "auto-restoring" &&
    snapshot !== null &&
    snapshot.operationStatus === "idle" &&
    ((snapshot.hasLocalIndex && snapshot.hasLocalMek) ||
      remoteStatus?.status === "has-backup");

  const canOpenAdvancedReset = advancedResetAvailable && !busy;

  const handleAdvancedReset = () => {
    setAdvancedMenuOpen(false);
    if (!snapshot) return;
    if (snapshot.hasLocalIndex && snapshot.hasLocalMek) {
      handleBeginReset();
    } else {
      handleDiscardAndRestart();
    }
  };

  useEffect(() => {
    if (advancedMenuOpen) advancedResetRef.current?.focus();
  }, [advancedMenuOpen]);

  useEffect(() => {
    if (!canOpenAdvancedReset) setAdvancedMenuOpen(false);
  }, [canOpenAdvancedReset]);

  const handleOpen = (item: VaultSnapshotItem) => {
    const dotIndex = item.name.lastIndexOf(".");
    const ext = dotIndex > 0 ? item.name.slice(dotIndex).toLowerCase() : "";
    if (isBrowserOpenableExt(ext)) {
      void (async () => {
        try {
          const path = await window.electronAPI.vault.getFilePath(item.name);
          openFilePathInBrowser(path);
        } catch (openError: unknown) {
          setError(errorText(openError, t));
        }
      })();
      return;
    }
    if (!isPreviewableExt(ext)) {
      void runAction(async () => {
        const result = await window.electronAPI.vault.openFile(item.name);
        if (result.error) throw new Error(result.error);
        return window.electronAPI.vault.getSnapshot();
      });
      return;
    }
    void (async () => {
      try {
        const path = await window.electronAPI.vault.getFilePath(item.name);
        openPreview({ path, name: item.name });
      } catch (openError: unknown) {
        setError(errorText(openError, t));
      }
    })();
  };

  const handleDelete = (item: VaultSnapshotItem) => {
    setPendingConfirmation({ kind: "delete", item });
  };

  // 上传失败由 runAction 统一报错（顶部横幅）；本地原件在失败时不会被删，
  // 因此候选列表里仍然有它 —— 用户可以直接重试。
  // 加入密库是本地搬移：先问一次（仅当所选技能里有内容不会被同步），再整批执行。
  const runAddSkills = useCallback(
    async (names: string[], confirmSkippedLinks: boolean) => {
      setPendingLinkConfirm(null);
      setBusy(true);
      setError(null);
      try {
        const result = await window.electronAPI.vault.addSkillsToVault(
          names,
          confirmSkippedLinks,
        );
        if (result.needsConfirmation && result.needsConfirmation.length > 0) {
          setPendingLinkConfirm(result.needsConfirmation);
          return;
        }
        setSelectedSkills(new Set());
        const parts: string[] = [];
        if (result.added.length > 0) {
          parts.push(
            t("vault.skills.addResult", { count: result.added.length }),
          );
        }
        if (result.indexError) {
          // 文件已搬进密库、索引没写成（下一次 reconcile 会补上）—— 必须说出来
          parts.push(skillAddErrorText(result.indexError, t));
        }
        for (const failure of result.failed) {
          parts.push(
            `${failure.name} · ${skillAddErrorText(failure.reason, t)}`,
          );
        }
        setSkillAddResult(parts.join(" · "));
        await loadSnapshot();
      } catch (addError: unknown) {
        setError(errorText(addError, t));
      } finally {
        setBusy(false);
        void loadBackupUsage();
      }
    },
    [loadBackupUsage, loadSnapshot, t],
  );

  const toggleSkillSelection = useCallback((name: string) => {
    setSelectedSkills((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const skillQueryLower = skillQuery.trim().toLowerCase();
  const matchesSkill = (name: string, description: string) =>
    !skillQueryLower ||
    name.toLowerCase().includes(skillQueryLower) ||
    description.toLowerCase().includes(skillQueryLower);
  const vaultSkillRows = (snapshot?.skills ?? []).filter((skill) =>
    matchesSkill(skill.name, ""),
  );
  const addableRows = (snapshot?.addableSkills ?? []).filter((skill) =>
    matchesSkill(skill.name, skill.description),
  );

  const handleConfirm = () => {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending) return;

    if (pending.kind === "delete") {
      void runAction(() =>
        window.electronAPI.vault.deleteFile(pending.item.name),
      );
      return;
    }
    if (pending.kind === "delete-skill") {
      void runAction(() =>
        window.electronAPI.vault.deleteSkillFromVault(pending.name),
      );
      return;
    }
    if (!token) return;
    if (pending.kind === "discard-new-device") {
      void runAction(async () => {
        await window.electronAPI.vault.discardRemoteBackupAndStart(token);
        return window.electronAPI.vault.getSnapshot();
      });
      return;
    }
    void runAction(async () => {
      const preparation =
        await window.electronAPI.vault.beginDiscardAndReinitialize(token);
      setRecoveryCode(preparation.recoveryCode);
      setRecoveryConfirmed(false);
      setResetPending(true);
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const setupBlockedByRemoteBackup =
    mode === "local-files" &&
    snapshot !== null &&
    !snapshot.hasLocalMek &&
    token !== null &&
    remoteStatus?.status !== "no-backup";

  const uploadDisabled = useMemo(() => {
    if (!snapshot || busy) return true;
    if (!snapshot.hasLocalMek) return true;
    return (
      mode === "auto-restoring" ||
      mode === "first-setup" ||
      mode === "resetting"
    );
  }, [snapshot, busy, mode]);

  const syncDisabled = useMemo(() => {
    if (!snapshot || busy) return true;
    return (
      mode === "auto-restoring" ||
      mode === "first-setup" ||
      mode === "resetting"
    );
  }, [snapshot, busy, mode]);

  const showFiles = mode === "normal" || mode === "local-files";
  const syncActionLabel =
    syncFeedback === "syncing" ? t("vault.syncing") : t("vault.sync");
  // 状态槽删除后，「已是最新 / 同步完成」唯一的可见出口
  const syncTooltipLabel =
    syncFeedback === "success" && syncFeedbackMessage
      ? syncFeedbackMessage
      : syncActionLabel;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background px-6 py-5"
      onClick={(event) => {
        if (
          advancedMenuOpen &&
          (!(event.target instanceof Node) ||
            !advancedMenuBoundaryRef.current?.contains(event.target))
        ) {
          setAdvancedMenuOpen(false);
        }
      }}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView("chat")}
            aria-label={t("common.back")}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {t("vault.title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {t("vault.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="sr-only">
            {syncFeedback === "syncing"
              ? t("vault.syncing")
              : syncFeedback === "success"
                ? (syncFeedbackMessage ?? "")
                : ""}
          </span>
          <Tooltip label={syncTooltipLabel}>
            <button
              type="button"
              aria-label={syncActionLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleSync()}
              disabled={syncDisabled}
            >
              {syncFeedback === "success" ? (
                <Check className="h-4 w-4 text-success" />
              ) : syncFeedback === "error" ? (
                <AlertTriangle className="h-4 w-4 text-error" />
              ) : (
                <RefreshCw
                  className={`h-4 w-4 ${
                    syncFeedback === "syncing" ? "animate-spin" : ""
                  }`}
                />
              )}
            </button>
          </Tooltip>
          {advancedResetAvailable && (
            <div
              ref={advancedMenuBoundaryRef}
              className="relative"
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (
                  !(next instanceof Node) ||
                  !event.currentTarget.contains(next)
                ) {
                  setAdvancedMenuOpen(false);
                }
              }}
            >
              <Tooltip label={t("vault.menu.more")}>
                <button
                  ref={advancedMenuTriggerRef}
                  type="button"
                  aria-label={t("vault.menu.more")}
                  aria-haspopup="menu"
                  aria-expanded={advancedMenuOpen}
                  aria-controls="vault-advanced-menu"
                  disabled={busy}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setAdvancedMenuOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setAdvancedMenuOpen(false);
                      event.currentTarget.focus();
                    }
                  }}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </Tooltip>
              {advancedMenuOpen && (
                <div
                  id="vault-advanced-menu"
                  role="menu"
                  aria-label={t("vault.menu.advanced")}
                  className={`${MENU_PANEL_PADDED_CLASS} absolute right-0 top-10 z-20 min-w-64 animate-menu-in-down`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setAdvancedMenuOpen(false);
                      advancedMenuTriggerRef.current?.focus();
                    }
                  }}
                >
                  <div className={MENU_LABEL_CLASS}>
                    {t("vault.menu.advanced")}
                  </div>
                  <button
                    ref={advancedResetRef}
                    type="button"
                    role="menuitem"
                    className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DANGER_CLASS}`}
                    onClick={handleAdvancedReset}
                  >
                    {t("vault.reset.discard")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {syncFeedback === "error" && syncFeedbackMessage && (
        <div
          className="mt-4 flex items-center justify-between rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
          role="status"
        >
          <span>{syncFeedbackMessage}</span>
          {syncFeedback === "error" && (
            <button
              type="button"
              aria-label={t("vault.dismiss")}
              className="ml-3 text-xs underline-offset-2 hover:underline"
              onClick={() => {
                setSyncFeedback("idle");
                setSyncFeedbackMessage(null);
              }}
            >
              {t("vault.dismiss")}
            </button>
          )}
        </div>
      )}

      {showFiles ? (
        <>
          <div className="mt-5 flex gap-1 border-b border-border-subtle">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setFilter(item)}
                className={`border-b-2 px-3 py-2 text-sm ${
                  filter === item
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {t(`vault.filter.${item}`)}
              </button>
            ))}
          </div>

          {showFiles && filter === "skills" && selectedSkills.size > 0 && (
            <div
              data-testid="skills-action-bar"
              className="sticky bottom-0 mt-3 flex items-center gap-2 rounded-xl border border-accent bg-accent-muted px-3 py-2"
            >
              <span className="text-xs font-medium text-text-primary">
                {t("vault.skills.selectedCount", {
                  count: selectedSkills.size,
                })}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="rounded-lg border border-border-subtle px-3 py-1 text-xs text-text-primary hover:bg-surface-hover"
                onClick={() => setSelectedSkills(new Set())}
              >
                {t("vault.skills.clearSelection")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/40"
                disabled={busy}
                onClick={() => void runAddSkills([...selectedSkills], false)}
              >
                {t("vault.skills.addSelected", { count: selectedSkills.size })}
              </button>
            </div>
          )}

          {pendingLinkConfirm && (
            <div className="mt-3 rounded-xl border border-warning bg-warning/10 p-3">
              <p className="text-sm font-medium text-text-primary">
                {t("vault.skills.addNeedsConfirm")}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {t("vault.skills.addNeedsConfirmHint", {
                  count: pendingLinkConfirm.reduce(
                    (total, entry) => total + entry.symlinkedEntries.length,
                    0,
                  ),
                })}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                {t("vault.skills.symlinked")}
              </p>
              <ul className="mb-2 list-inside list-disc text-xs text-text-muted">
                {pendingLinkConfirm.map((entry) => (
                  <li key={entry.name}>
                    {entry.name} · {entry.symlinkedEntries.length}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-border-subtle px-3 py-1 text-xs text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setPendingLinkConfirm(null)}
                >
                  {t("vault.skills.cancelAdd")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/40"
                  onClick={() =>
                    void runAddSkills(
                      pendingLinkConfirm.map((entry) => entry.name),
                      true,
                    )
                  }
                >
                  {t("vault.skills.addConfirm")}
                </button>
              </div>
            </div>
          )}

          {filter === "skills" && skillAddResult && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-secondary">
              <span>{skillAddResult}</span>
              <button
                type="button"
                className="ml-3 text-xs hover:underline"
                onClick={() => setSkillAddResult(null)}
              >
                {t("vault.dismiss")}
              </button>
            </div>
          )}

          {filter === "files" && (
            <div className="flex items-center justify-between py-3">
              <div className="flex flex-col gap-0.5 text-xs text-text-muted">
                <span>
                  {t("vault.fileCount", { count: visibleItems.length })}
                </span>
                <span>
                  {t("vault.localUsage", {
                    used: formatSize(snapshot?.usedBytes ?? 0),
                  })}
                </span>
                {backupUsage && (
                  <span>
                    {t(
                      backupUsage.quotaBytes === null
                        ? "vault.backupUsageNoQuota"
                        : "vault.backupUsage",
                      {
                        used: formatSize(backupUsage.usedBytes),
                        quota: formatSize(backupUsage.quotaBytes ?? 0),
                      },
                    )}
                  </span>
                )}
              </div>
              <Tooltip label={t("vault.upload")}>
                <button
                  type="button"
                  aria-label={t("vault.upload")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/40"
                  onClick={handleUpload}
                  disabled={uploadDisabled}
                >
                  <Upload className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {filter === "skills" && (
              <div className="flex flex-col gap-2 py-3">
                <input
                  type="search"
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder={t("vault.skills.searchPlaceholder")}
                  className="w-full rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-text-primary"
                />

                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-text-muted">
                    {t("vault.skills.groupVault", {
                      count: vaultSkillRows.length,
                    })}
                  </p>
                  {vaultSkillRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-text-muted">
                      {t("vault.skills.empty")}
                    </p>
                  ) : (
                    <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                      {vaultSkillRows.map((skill) => (
                        <article
                          key={skill.name}
                          className="flex select-none items-center gap-4 px-4 py-3"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {skill.name}
                            </p>
                            <p className="mt-1 text-xs text-text-muted">
                              {t("vault.skills.summary", {
                                count: skill.fileCount,
                                size: formatSize(skill.totalBytes),
                              })}{" "}
                              · {statusText(skill.syncStatus, t)}
                            </p>
                            {skill.syncStatus === "pending" && (
                              <p className="mt-0.5 text-xs text-text-muted">
                                {t("vault.skills.pendingHint")}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={t("vault.skills.delete", {
                              name: skill.name,
                            })}
                            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() =>
                              setPendingConfirmation({
                                kind: "delete-skill",
                                name: skill.name,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-text-muted">
                    {t("vault.skills.groupAddable", {
                      count: addableRows.length,
                    })}
                  </p>
                  {addableRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-text-muted">
                      {skillQuery
                        ? t("vault.skills.noMatch")
                        : t("vault.skills.noAddable")}
                    </p>
                  ) : (
                    <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                      {addableRows.map((skill) => {
                        const isSelected = selectedSkills.has(skill.name);
                        return (
                          <label
                            key={skill.name}
                            className={`flex cursor-pointer select-none items-center gap-3 px-4 py-3 ${
                              isSelected ? "bg-accent-muted" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSkillSelection(skill.name)}
                              className="h-4 w-4 shrink-0 accent-accent"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text-primary">
                                {skill.name}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-text-muted">
                                {skill.description ||
                                  t("vault.skills.missingDescription")}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {filter === "sessions" && (
              <p className="py-12 text-center text-sm text-text-muted">
                {t("vault.comingSoon")}
              </p>
            )}

            {filter === "files" &&
              (visibleItems.length === 0 ? (
                <p className="py-12 text-center text-sm text-text-muted">
                  {t("vault.empty")}
                </p>
              ) : (
                <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                  {visibleItems.map((item) => (
                    <article
                      key={item.name}
                      className="flex select-none items-center gap-4 px-4 py-3"
                      onDoubleClick={() => handleOpen(item)}
                    >
                      <FileTypeIcon kind={getFileKind(item.name)} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {item.name}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {formatSize(item.size)} ·{" "}
                          {statusText(item.syncStatus, t)}
                        </p>
                      </div>
                      <div
                        className="relative flex shrink-0 items-center gap-1"
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={t("vault.action.export", {
                            name: item.name,
                          })}
                          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            void runAction(() =>
                              window.electronAPI.vault.exportFile(item.name),
                            );
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("vault.action.more", {
                            name: item.name,
                          })}
                          aria-haspopup="menu"
                          aria-expanded={openMenu === item.name}
                          aria-controls={`vault-menu-${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
                          onClick={() =>
                            setOpenMenu((current) =>
                              current === item.name ? null : item.name,
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setOpenMenu(null);
                              event.currentTarget.focus();
                            }
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenu === item.name && (
                          <div
                            id={`vault-menu-${item.name}`}
                            role="menu"
                            className={`${MENU_PANEL_PADDED_CLASS} absolute right-0 top-8 z-10 min-w-32 animate-menu-in-down`}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setOpenMenu(null);
                            }}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DEFAULT_CLASS}`}
                              onClick={() => {
                                setOpenMenu(null);
                                void runAction(() =>
                                  window.electronAPI.vault.revealFile(
                                    item.name,
                                  ),
                                );
                              }}
                            >
                              {t("vault.action.reveal")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className={`${MENU_ITEM_CLASS} ${MENU_ITEM_DANGER_CLASS}`}
                              onClick={() => {
                                setOpenMenu(null);
                                handleDelete(item);
                              }}
                            >
                              {t("vault.action.delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
            {snapshot?.hasLocalMek ? (
              <span className="text-sm text-text-muted">
                {t("vault.setup.configured")}
              </span>
            ) : (
              <button
                type="button"
                className="text-sm text-text-secondary underline-offset-2 hover:underline"
                onClick={() => void handleGenerateRecoveryCode()}
              >
                {t("vault.setup.open")}
              </button>
            )}
            {!token && (
              <span className="text-xs text-text-muted">
                {t("vault.loginHint")}
              </span>
            )}
            {snapshot && snapshot.pendingCount > 0 && (
              <span className="text-xs text-text-muted">
                {t("vault.pendingCount", { count: snapshot.pendingCount })}
              </span>
            )}
          </div>
        </>
      ) : (
        renderEmptyState(mode, {
          t,
          snapshot,
          recoveryCode,
          recoveryConfirmed,
          restoreCode,
          resetPending,
          busy,
          token,
          setRestoreCode,
          setRecoveryConfirmed,
          retryRemoteStatus: () => {
            setRemoteStatus(null);
            setRemoteStatusRetry((value) => value + 1);
          },
          retryReset,
          handleRestore,
          handleInitialize,
          handleGenerateRecoveryCode,
          retryAutoRestore,
          handleUpload,
          uploadDisabled,
          setError,
        })
      )}

      {recoveryCode &&
        (resetPending ||
          (mode === "local-files" &&
            snapshot !== null &&
            !snapshot.hasLocalMek)) && (
          <div className="mt-3 rounded-xl border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("vault.setup.title")}
            </h2>
            <p className="mt-2 break-all rounded bg-background px-3 py-2 font-mono text-sm text-text-primary">
              {recoveryCode}
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={recoveryConfirmed}
                onChange={(event) => setRecoveryConfirmed(event.target.checked)}
              />
              {t("vault.setup.confirmSaved")}
            </label>
            {setupBlockedByRemoteBackup && remoteStatus?.status && (
              <>
                {remoteStatus.status === "error" && (
                  <>
                    <p className="mt-2 text-xs text-text-muted">
                      {t("vault.restore.remoteError")}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-text-secondary underline-offset-2 hover:underline"
                      onClick={() => {
                        setRemoteStatus(null);
                        setRemoteStatusRetry((value) => value + 1);
                      }}
                      disabled={busy}
                    >
                      {t("vault.restore.retry")}
                    </button>
                  </>
                )}
              </>
            )}
            <button
              type="button"
              className="mt-3 rounded bg-accent px-3 py-2 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:bg-accent/40"
              onClick={() => void handleInitialize()}
              disabled={
                !recoveryConfirmed || busy || setupBlockedByRemoteBackup
              }
            >
              {t("vault.setup.finish")}
            </button>
          </div>
        )}

      <ConfirmDialog
        isOpen={pendingConfirmation !== null}
        title={
          pendingConfirmation?.kind === "delete"
            ? t("vault.confirm.delete", {
                name: pendingConfirmation.item.name,
              })
            : pendingConfirmation?.kind === "delete-skill"
              ? t("vault.skills.confirmDelete", {
                  name: pendingConfirmation.name,
                })
              : pendingConfirmation?.kind === "discard-new-device"
                ? t("vault.reset.confirmNewDevice")
                : t("vault.reset.confirmExisting")
        }
        confirmLabel={
          pendingConfirmation?.kind === "delete" ||
          pendingConfirmation?.kind === "delete-skill"
            ? t("vault.confirm.deleteAction")
            : pendingConfirmation?.kind === "discard-new-device"
              ? t("vault.reset.discardAction")
              : t("vault.reset.resetAction")
        }
        onConfirm={handleConfirm}
        onCancel={() => setPendingConfirmation(null)}
      />
    </section>
  );
}

interface EmptyStateHandlers {
  t: (key: string) => string;
  snapshot: VaultSnapshot | null;
  recoveryCode: string | null;
  recoveryConfirmed: boolean;
  restoreCode: string;
  resetPending: boolean;
  busy: boolean;
  token: string | null;
  setRestoreCode: (value: string) => void;
  setRecoveryConfirmed: (value: boolean) => void;
  retryRemoteStatus: () => void;
  retryReset: () => void;
  handleRestore: () => void;
  handleInitialize: () => Promise<void>;
  handleGenerateRecoveryCode: () => Promise<void>;
  retryAutoRestore: () => void;
  handleUpload: () => void;
  uploadDisabled: boolean;
  setError: (value: string | null) => void;
}

function renderEmptyState(
  mode: EmptyVaultMode,
  h: EmptyStateHandlers,
): JSX.Element {
  const { t } = h;

  if (mode === "resetting") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-text-muted">{t("vault.reset.inProgress")}</p>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/40"
          onClick={h.retryReset}
          disabled={h.busy || !h.token}
        >
          {t("vault.reset.retry")}
        </button>
      </div>
    );
  }

  if (mode === "auto-restoring") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-subtle border-t-accent" />
        <p className="text-sm text-text-muted">
          {t("vault.restore.restoring")}
        </p>
      </div>
    );
  }

  if (mode === "remote-error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-text-muted">
          {t("vault.restore.remoteError")}
        </p>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground hover:bg-accent/90"
          onClick={() => {
            h.setError(null);
            h.retryRemoteStatus();
          }}
        >
          {t("vault.restore.retry")}
        </button>
      </div>
    );
  }

  if (mode === "restore-error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-text-muted">{t("vault.restore.failed")}</p>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground hover:bg-accent/90"
          onClick={h.retryAutoRestore}
        >
          {t("vault.restore.retry")}
        </button>
      </div>
    );
  }

  if (mode === "recovery-input") {
    return (
      <div className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
        <p className="text-sm text-text-secondary">
          {t("vault.restore.prompt")}
        </p>
        <input
          type="text"
          aria-label={t("vault.recoveryCode")}
          value={h.restoreCode}
          onChange={(event) => h.setRestoreCode(event.target.value)}
          placeholder={t("vault.recoveryCode")}
          className="rounded border border-border-subtle bg-background px-2 py-1.5 text-xs text-text-primary"
        />
        <button
          type="button"
          className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:bg-accent/40"
          onClick={h.handleRestore}
          disabled={h.busy || !h.restoreCode}
        >
          {t("vault.restore.action")}
        </button>
      </div>
    );
  }

  if (mode === "first-setup") {
    return (
      <div className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {t("vault.firstSetup.title")}
        </h2>
        <p className="text-sm text-text-muted">{t("vault.firstSetup.body")}</p>
        {!h.recoveryCode && (
          <button
            type="button"
            className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground"
            onClick={() => void h.handleGenerateRecoveryCode()}
          >
            {t("vault.setup.open")}
          </button>
        )}
        {h.recoveryCode && (
          <>
            <p className="break-all rounded bg-background px-3 py-2 font-mono text-sm text-text-primary">
              {h.recoveryCode}
            </p>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={h.recoveryConfirmed}
                onChange={(event) =>
                  h.setRecoveryConfirmed(event.target.checked)
                }
              />
              {t("vault.setup.confirmSaved")}
            </label>
            <button
              type="button"
              className="rounded bg-accent px-3 py-2 text-sm text-accent-foreground disabled:cursor-not-allowed disabled:bg-accent/40"
              onClick={() => void h.handleInitialize()}
              disabled={!h.recoveryConfirmed || h.busy}
            >
              {t("vault.setup.finish")}
            </button>
          </>
        )}
      </div>
    );
  }

  if (mode === "empty-ready") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-text-muted">{t("vault.empty")}</p>
        {!h.token && (
          <p className="text-xs text-text-muted">{t("vault.loginHint")}</p>
        )}
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-accent/40"
          onClick={h.handleUpload}
          disabled={h.uploadDisabled}
        >
          {t("vault.upload")}
        </button>
      </div>
    );
  }

  // loading
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-sm text-text-muted">{t("vault.empty")}</p>
      {!h.token && (
        <p className="text-xs text-text-muted">{t("vault.loginHint")}</p>
      )}
    </div>
  );
}
