import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import type {
  SyncStatus,
  VaultRemoteStatus,
  VaultSnapshot,
  VaultSnapshotItem,
} from "../../shared/vault";

type Filter = "all" | "documents" | "skills" | "sessions" | "other";
type SyncFeedback = "idle" | "syncing" | "success" | "error";
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

const FILTERS: Filter[] = ["all", "documents", "skills", "sessions", "other"];

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "json",
  "md",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);
const SKILL_EXTENSIONS = new Set(["skill", "zip"]);
const SESSION_EXTENSIONS = new Set(["jsonl", "session"]);

function fileCategory(ext: string): Exclude<Filter, "all"> {
  if (DOCUMENT_EXTENSIONS.has(ext)) return "documents";
  if (SKILL_EXTENSIONS.has(ext)) return "skills";
  if (SESSION_EXTENSIONS.has(ext)) return "sessions";
  return "other";
}

function statusText(status: SyncStatus, t: (key: string) => string): string {
  if (status === "synced") return t("vault.status.synced");
  if (status === "failed") return t("vault.status.failed");
  return t("vault.status.pending");
}

function errorText(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof Error)) return t("vault.error.localOperation");
  const message = error.message;
  if (message === "VAULT_FILE_TOO_LARGE") return t("vault.error.fileTooLarge");
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
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback>("idle");
  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState<string | null>(
    null,
  );
  const syncFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRestoreFired = useRef(false);
  const setupGenerated = useRef(false);

  useEffect(() => {
    return () => {
      if (syncFeedbackTimer.current) clearTimeout(syncFeedbackTimer.current);
    };
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      setSnapshot(await window.electronAPI.vault.getSnapshot());
    } catch (loadError: unknown) {
      setError(errorText(loadError, t));
    }
  }, [t]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

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
    const items = snapshot?.items ?? [];
    if (filter === "all") return items;
    return items.filter((item) => fileCategory(item.ext) === filter);
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
      }
    },
    [loadSnapshot, t],
  );

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
    if (!token) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(t("vault.error.loginRequired"));
      return;
    }
    const pendingBefore = snapshot?.pendingCount ?? null;
    setBusy(true);
    setError(null);
    setSyncFeedback("syncing");
    setSyncFeedbackMessage(t("vault.syncing"));

    try {
      const nextSnapshot = await window.electronAPI.vault.sync(token);
      setSnapshot(nextSnapshot);
      if (nextSnapshot.pendingCount > 0) {
        setSyncFeedback("error");
        setSyncFeedbackMessage(t("vault.error.syncFailed"));
        return;
      }
      setSyncFeedback("success");
      setSyncFeedbackMessage(
        pendingBefore === 0
          ? t("vault.alreadyLatest")
          : t("vault.syncComplete"),
      );
      syncFeedbackTimer.current = setTimeout(() => {
        setSyncFeedback("idle");
        setSyncFeedbackMessage(null);
        syncFeedbackTimer.current = null;
      }, 3000);
    } catch (syncError: unknown) {
      setSyncFeedback("error");
      setSyncFeedbackMessage(errorText(syncError, t));
    } finally {
      setBusy(false);
    }
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
    if (!token) return;
    if (!window.confirm(t("vault.reset.confirmNewDevice"))) return;
    void runAction(async () => {
      await window.electronAPI.vault.discardRemoteBackupAndStart(token);
      return window.electronAPI.vault.getSnapshot();
    });
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
    if (!token) return;
    if (!window.confirm(t("vault.reset.confirmExisting"))) return;
    void runAction(async () => {
      const preparation =
        await window.electronAPI.vault.beginDiscardAndReinitialize(token);
      setRecoveryCode(preparation.recoveryCode);
      setRecoveryConfirmed(false);
      setResetPending(true);
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const handleOpen = (item: VaultSnapshotItem) => {
    void runAction(async () => {
      const result = await window.electronAPI.vault.openFile(item.name);
      if (result.error) throw new Error(result.error);
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const handleDelete = (item: VaultSnapshotItem) => {
    if (!window.confirm(t("vault.confirm.delete", { name: item.name }))) return;
    void runAction(() => window.electronAPI.vault.deleteFile(item.name));
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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background px-6 py-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {t("vault.title")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t("vault.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            onClick={() =>
              void runAction(() => window.electronAPI.vault.importFile())
            }
            disabled={uploadDisabled}
          >
            {t("vault.upload")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
            onClick={() => void handleSync()}
            disabled={syncDisabled}
          >
            {syncFeedback === "syncing" ? t("vault.syncing") : t("vault.sync")}
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {syncFeedback !== "idle" && syncFeedbackMessage && (
        <div
          className={`mt-4 flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
            syncFeedback === "error"
              ? "border-error/30 bg-error/10 text-error"
              : syncFeedback === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-border-subtle bg-surface text-text-secondary"
          }`}
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

          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {visibleItems.length === 0 ? (
              <p className="py-12 text-center text-sm text-text-muted">
                {t("vault.empty")}
              </p>
            ) : (
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {visibleItems.map((item) => (
                  <article
                    key={item.name}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {item.name}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {formatSize(item.size)} ·{" "}
                        {statusText(item.syncStatus, t)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => handleOpen(item)}
                      >
                        {t("vault.action.open")}
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text-primary"
                        onClick={() =>
                          void runAction(() =>
                            window.electronAPI.vault.revealFile(item.name),
                          )
                        }
                      >
                        {t("vault.action.reveal")}
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text-primary"
                        onClick={() =>
                          void runAction(() =>
                            window.electronAPI.vault.exportFile(item.name),
                          )
                        }
                      >
                        {t("vault.action.export")}
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-error hover:bg-error/10"
                        onClick={() => handleDelete(item)}
                      >
                        {t("vault.action.delete")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
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
            {snapshot?.hasLocalIndex && snapshot.hasLocalMek && (
              <button
                type="button"
                className="ml-auto text-xs text-error underline-offset-2 hover:underline"
                onClick={handleBeginReset}
              >
                {t("vault.reset.discard")}
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
          handleDiscardAndRestart,
          retryAutoRestore,
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
                {remoteStatus.status === "has-backup" && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-error underline-offset-2 hover:underline"
                    onClick={handleDiscardAndRestart}
                    disabled={busy}
                  >
                    {t("vault.reset.discard")}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              className="mt-3 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={() => void handleInitialize()}
              disabled={
                !recoveryConfirmed || busy || setupBlockedByRemoteBackup
              }
            >
              {t("vault.setup.finish")}
            </button>
          </div>
        )}
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
  handleDiscardAndRestart: () => void;
  retryAutoRestore: () => void;
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
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
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
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90"
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
          className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90"
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
          className="rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
          onClick={h.handleRestore}
          disabled={h.busy || !h.restoreCode}
        >
          {t("vault.restore.action")}
        </button>
        <button
          type="button"
          className="text-xs text-error underline-offset-2 hover:underline"
          onClick={h.handleDiscardAndRestart}
        >
          {t("vault.reset.discard")}
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
            className="rounded bg-accent px-3 py-2 text-sm text-white"
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
              className="rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
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

  // empty-ready and loading
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
      <p className="text-sm text-text-muted">{t("vault.empty")}</p>
      {!h.token && (
        <p className="text-xs text-text-muted">{t("vault.loginHint")}</p>
      )}
    </div>
  );
}
