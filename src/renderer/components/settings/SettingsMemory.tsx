import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsContentSection } from "./shared";

export function SettingsMemory() {
  const { t } = useTranslation();
  const appConfig = useAppStore((state) => state.appConfig);

  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const enabled = appConfig?.memoryEnabled ?? false;

  const handleToggle = async () => {
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.setEnabled(!enabled);
      setStatus(
        !enabled ? t("memory.enabledStatus") : t("memory.disabledStatus"),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const doClearAll = async () => {
    setIsBusy(true);
    setStatus(null);
    try {
      await window.electronAPI.memory.clearAll();
      setStatus(t("memory.clearAllSuccess"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsContentSection
        title={t("memory.title")}
        description={t("memory.description")}
      >
        <div className="flex flex-col gap-3 rounded-2xl border border-border-muted bg-background-secondary/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {t("memory.enableLocal")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("memory.enableLocalDesc")}
              </p>
            </div>
            <button
              onClick={() => {
                void handleToggle();
              }}
              disabled={isBusy}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                enabled
                  ? "bg-accent text-accent-foreground hover:opacity-90"
                  : "bg-surface hover:bg-surface-hover text-text-primary border border-border"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {enabled ? t("memory.disableAction") : t("memory.enableAction")}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-muted pt-3">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {t("memory.deleteLocal")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("memory.deleteLocalDesc")}
              </p>
            </div>
            <button
              onClick={() => setPendingDelete(true)}
              disabled={isBusy}
              className="rounded-lg border border-rose-300/60 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
            >
              {t("memory.deleteAction")}
            </button>
          </div>
        </div>
      </SettingsContentSection>

      {status && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/70 px-4 py-3 text-sm text-text-secondary">
          {status}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDelete}
        title={t("memory.clearAllConfirm")}
        onConfirm={() => {
          setPendingDelete(false);
          void doClearAll();
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
