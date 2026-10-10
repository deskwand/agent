import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Save,
  Globe,
  Trash2,
  Copy,
} from "lucide-react";
import { formatAppDateTime } from "../../utils/i18n-format";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsContentSection } from "./shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { Button } from "../app-button";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

export function SettingsLogs({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [logFiles, setLogFiles] = useState<
    Array<{ name: string; path: string; size: number; mtime: Date }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [logsDirectory, setLogsDirectory] = useState("");
  const [devLogsEnabled, setDevLogsEnabled] = useState(true);
  const [pendingClear, setPendingClear] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      const [files, dir] = await Promise.all([
        window.electronAPI.logs.getAll(),
        window.electronAPI.logs.getDirectory(),
      ]);
      setLogFiles(files || []);
      setLogsDirectory(dir || "");
      setError("");
    } catch (err) {
      console.error("Failed to load logs:", err);
      setError(t("logs.exportFailed"));
    }
  }, [t]);

  const loadDevLogsStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.logs.isEnabled();
      if (result.success && typeof result.enabled === "boolean") {
        setDevLogsEnabled(result.enabled);
      }
    } catch (err) {
      console.error("Failed to load dev logs status:", err);
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return;
    }
    void loadLogs();
    void loadDevLogsStatus();
    const interval = setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive, loadDevLogsStatus, loadLogs]);

  async function handleToggleDevLogs() {
    setIsLoading(true);
    setError("");
    setSuccess("");
    try {
      const newEnabled = !devLogsEnabled;
      const result = await window.electronAPI.logs.setEnabled(newEnabled);
      if (result.success) {
        setDevLogsEnabled(newEnabled);
        setSuccess(
          newEnabled ? t("logs.devLogsEnabled") : t("logs.devLogsDisabled"),
        );
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(result.error || t("logs.toggleFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logs.toggleFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExport() {
    setIsLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await window.electronAPI.logs.export();
      if (result.success) {
        setSuccess(t("logs.exportSuccess", { path: result.path }));
        setTimeout(() => setSuccess(""), 5000);
      } else {
        setError(result.error || t("logs.exportFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logs.exportFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpen() {
    setIsLoading(true);
    try {
      await window.electronAPI.logs.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logs.exportFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  async function doClear() {
    setIsLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await window.electronAPI.logs.clear();
      if (result.success) {
        setSuccess(t("logs.clearSuccess", { count: result.deletedCount }));
        await loadLogs();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(result.error || t("logs.clearFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logs.clearFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  function handleClear() {
    setPendingClear(true);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(date: Date): string {
    return formatAppDateTime(date);
  }

  const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Developer Logs Toggle */}
      <section className="rounded-2xl border border-border/40 bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">
              {t("logs.enableDevLogs")}
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("logs.enableDevLogsDesc")}
            </p>
          </div>
          <Button variant="ghost"
            onClick={handleToggleDevLogs}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              devLogsEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                devLogsEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </Button>
        </div>
      </section>

      {/* Stats */}
      <SettingsContentSection
        title={t("logs.logFiles")}
        description={t("logs.inventoryDescription")}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-background border border-border/40">
            <div className="text-2xl font-bold text-foreground">
              {logFiles.length}
            </div>
            <div className="text-sm text-muted-foreground">{t("logs.logFiles")}</div>
          </div>
          <div className="p-4 rounded-xl bg-background border border-border/40">
            <div className="text-2xl font-bold text-foreground">
              {formatFileSize(totalSize)}
            </div>
            <div className="text-sm text-muted-foreground">{t("logs.totalSize")}</div>
          </div>
        </div>
      </SettingsContentSection>

      {/* Log Files List */}
      <SettingsContentSection
        title={t("logs.logFiles")}
        description={t("logs.recentDescription")}
      >
        {logFiles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t("logs.noLogFiles")}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logFiles.map((file) => (
              <div
                key={file.path}
                className="p-3 rounded-xl bg-background border border-border/40"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-foreground truncate">
                      {file.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatFileSize(file.size)} • {formatDate(file.mtime)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsContentSection>

      {/* Directory Path */}
      {logsDirectory && (
        <SettingsContentSection
          title={t("logs.logsDirectory")}
          description={t("logs.directoryDescription")}
        >
          <div className="p-3 rounded-xl bg-background border border-border/40">
            <div className="text-xs text-muted-foreground mb-1">
              {t("logs.logsDirectory")}
            </div>
            <div className="flex items-start gap-2">
              <Button variant="ghost"
                className="font-mono text-xs text-muted-foreground break-all text-left hover:text-primary-text hover:underline cursor-pointer bg-transparent border-none p-0 h-auto"
                onClick={() => window.electronAPI.logs.open()}
                title={t("logs.openFolder")}
              >
                {logsDirectory}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost"
                    className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors h-auto"
                    onClick={() => navigator.clipboard.writeText(logsDirectory)}
                    aria-label={t("common.copy")}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
                    而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
                <TooltipContent side="bottom">
                  {t("common.copy")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </SettingsContentSection>
      )}

      {/* Action Buttons */}
      <SettingsContentSection
        title={t("logs.actionsTitle")}
        description={t("logs.actionsDescription")}
      >
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost"
            onClick={handleExport}
            disabled={isLoading}
            className="py-3 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2 h-auto"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="text-sm">{t("logs.exportZip")}</span>
          </Button>
          <Button variant="ghost"
            onClick={handleOpen}
            disabled={isLoading}
            className="py-3 px-4 rounded-lg bg-background border border-border/40 text-foreground font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2 h-auto"
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm">{t("logs.openFolder")}</span>
          </Button>
          <Button variant="ghost"
            onClick={handleClear}
            disabled={isLoading || logFiles.length === 0}
            className="py-3 px-4 rounded-lg bg-destructive/10 text-destructive font-medium hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2 h-auto"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm">{t("logs.clearAll")}</span>
          </Button>
        </div>
      </SettingsContentSection>

      {/* Help Text */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>{t("logs.helpText1")}</p>
        <p>{t("logs.helpText2")}</p>
      </div>

      <ConfirmDialog
        isOpen={pendingClear}
        title={t("logs.clearConfirm")}
        confirmLabel={t("logs.clearAll")}
        onConfirm={() => {
          setPendingClear(false);
          doClear();
        }}
        onCancel={() => setPendingClear(false)}
      />
    </div>
  );
}
