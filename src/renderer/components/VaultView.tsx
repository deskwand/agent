import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import type {
  SyncStatus,
  VaultSnapshot,
  VaultSnapshotItem,
} from "../../shared/vault";

type Filter = "all" | "documents" | "skills" | "sessions" | "other";
type SyncFeedback = "idle" | "syncing" | "success" | "error";

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
  if (error.message === "VAULT_FILE_TOO_LARGE") {
    return t("vault.error.fileTooLarge");
  }
  if (error.message === "VAULT_KEY_REQUIRED") {
    return t("vault.error.setupRequired");
  }
  if (error.message === "VAULT_RECOVERY_MISMATCH") {
    return t("vault.error.recoveryMismatch");
  }
  if (error.message === "VAULT_INVALID_RECOVERY_CODE") {
    return t("vault.error.invalidRecoveryCode");
  }
  if (error.message === "VAULT_ALREADY_INITIALIZED") {
    return t("vault.error.alreadyInitialized");
  }
  if (error.message === "VAULT_KEYCHAIN_UNAVAILABLE") {
    return t("vault.error.keychainUnavailable");
  }
  if (error.message === "VAULT_NO_REMOTE_BACKUP") {
    return t("vault.error.noRemoteBackup");
  }
  if (error.message === "VAULT_LOCAL_INDEX_EXISTS") {
    return t("vault.error.localIndexExists");
  }
  return t("vault.error.syncFailed");
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function VaultView(): JSX.Element {
  const { t } = useTranslation();
  const token = useAppStore((state) => state.cloudConfig?.token ?? null);
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [remoteAvailable, setRemoteAvailable] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [restoreCode, setRestoreCode] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback>("idle");
  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState<string | null>(
    null,
  );
  const syncFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!snapshot || snapshot.hasLocalIndex || !token) return;
    let canceled = false;
    void window.electronAPI.vault
      .checkRemoteBackup(token)
      .then((available) => {
        if (!canceled) setRemoteAvailable(available);
      })
      .catch(() => {
        if (!canceled) setRemoteAvailable(false);
      });
    return () => {
      canceled = true;
    };
  }, [snapshot, token]);

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

  const handleGenerateRecoveryCode = async () => {
    setError(null);
    if (recoveryCode) {
      setRecoveryConfirmed(false);
      setSetupOpen(true);
      return;
    }
    try {
      setRecoveryCode(await window.electronAPI.vault.generateRecoveryCode());
      setRecoveryConfirmed(false);
      setSetupOpen(true);
    } catch (setupError: unknown) {
      setError(errorText(setupError, t));
    }
  };

  const handleInitialize = async () => {
    if (!recoveryCode || !recoveryConfirmed) return;
    await runAction(async () => {
      await window.electronAPI.vault.initialize(token, recoveryCode);
      setSetupOpen(false);
      setRecoveryCode(null);
      return window.electronAPI.vault.getSnapshot();
    });
  };

  const handleRestore = () => {
    if (!token || !restoreCode) return;
    void runAction(async () => {
      await window.electronAPI.vault.restore(token, restoreCode);
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
            disabled={busy}
          >
            {t("vault.upload")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
            onClick={() => void handleSync()}
            disabled={busy}
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
                    {formatSize(item.size)} · {statusText(item.syncStatus, t)}
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
        {snapshot?.isInitialized ? (
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

      {remoteAvailable && !snapshot?.hasLocalIndex && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-text-secondary">
          <span>{t("vault.restore.prompt")}</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label={t("vault.recoveryCode")}
              value={restoreCode}
              onChange={(event) => setRestoreCode(event.target.value)}
              placeholder={t("vault.recoveryCode")}
              className="w-56 rounded border border-border-subtle bg-background px-2 py-1.5 text-xs text-text-primary"
            />
            <button
              type="button"
              className="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
              onClick={handleRestore}
              disabled={busy || !restoreCode}
            >
              {t("vault.restore.action")}
            </button>
          </div>
        </div>
      )}

      {setupOpen && recoveryCode && (
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
          <button
            type="button"
            className="mt-3 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => void handleInitialize()}
            disabled={!recoveryConfirmed || busy}
          >
            {t("vault.setup.finish")}
          </button>
        </div>
      )}
    </section>
  );
}
