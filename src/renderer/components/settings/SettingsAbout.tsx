import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Download,
} from "lucide-react";
import type { ServerEvent } from "../../types";
import logoUrl from "../../assets/logo.png";

interface SettingsAboutProps {
  appVersion: string;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export function SettingsAbout({ appVersion }: SettingsAboutProps) {
  const { t } = useTranslation();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleServerEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "update.available":
        setUpdateStatus("available");
        setUpdateVersion(event.payload.version);
        break;
      case "update.progress":
        setUpdateStatus("downloading");
        setUpdateProgress(Math.round(event.payload.percent));
        break;
      case "update.downloaded":
        setUpdateStatus("downloaded");
        setUpdateVersion(event.payload.version);
        break;
      case "update.not-available":
        setUpdateStatus("up-to-date");
        break;
      case "update.error":
        setUpdateStatus("error");
        setUpdateError(event.payload.message);
        break;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.on(handleServerEvent);
    return () => {
      unsubscribe?.();
    };
  }, [handleServerEvent]);

  const handleCheckUpdate = () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    window.electronAPI?.send({ type: "update.check", payload: {} });
  };

  const handleRestart = () => {
    window.electronAPI?.send({ type: "update.install", payload: {} });
  };

  const statusBadge = () => {
    switch (updateStatus) {
      case "checking":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t("about.checking")}
          </span>
        );
      case "up-to-date":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3 h-3" />
            {t("about.upToDate")}
          </span>
        );
      case "available":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <Download className="w-3 h-3" />
            {t("about.newVersionAvailable", { version: updateVersion })}
          </span>
        );
      case "downloading":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-accent">
            <Download className="w-3 h-3 animate-pulse" />
            {t("about.downloading", { percent: updateProgress })}
          </span>
        );
      case "downloaded":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3 h-3" />
            {t("about.readyToInstall")}
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 text-xs text-error">
            <AlertCircle className="w-3 h-3" />
            {t("about.updateFailed")}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col items-center py-10 space-y-6">
      {/* Icon */}
      <div className="w-20 h-20 rounded-[20px] ring-1 ring-border-subtle flex items-center justify-center shadow-sm overflow-hidden">
        <img src={logoUrl} alt="OMAGT" className="w-full h-full object-cover" />
      </div>

      {/* Name + Version */}
      <div className="text-center space-y-2">
        <h1 className="text-xl font-bold tracking-tight text-text-primary select-none">
          OMAGT
        </h1>
        <div className="flex flex-col items-center gap-1.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-surface-muted text-xs font-mono text-text-muted">
            v{appVersion || "—"}
          </span>
          {statusBadge()}
        </div>
      </div>

      {/* Progress bar */}
      {updateStatus === "downloading" && (
        <div className="w-48 h-1 bg-surface-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${updateProgress}%` }}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {updateStatus === "idle" && (
          <button
            onClick={handleCheckUpdate}
            className="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg
              bg-surface text-text-secondary hover:bg-surface-hover
              ring-1 ring-border-subtle hover:ring-border-muted
              transition-all duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("about.checkUpdate")}
          </button>
        )}

        {(updateStatus === "up-to-date" || updateStatus === "error") && (
          <button
            onClick={handleCheckUpdate}
            className="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg
              bg-surface text-text-secondary hover:bg-surface-hover
              ring-1 ring-border-subtle hover:ring-border-muted
              transition-all duration-150"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("about.checkAgain")}
          </button>
        )}

        {updateStatus === "downloaded" && (
          <button
            onClick={handleRestart}
            className="inline-flex items-center gap-2 text-xs px-5 py-2 rounded-lg
              bg-accent text-accent-foreground hover:bg-accent-hover
              shadow-sm transition-all duration-150"
          >
            {t("about.restartNow")}
          </button>
        )}

        {updateStatus === "error" && updateError && (
          <p className="text-xs text-text-muted max-w-[240px] text-center leading-relaxed">
            {updateError}
          </p>
        )}
      </div>
    </div>
  );
}
