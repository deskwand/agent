import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { ConfirmDialog } from "../ConfirmDialog";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./shared";
import { SettingsGlobalAgentsMd } from "./SettingsGlobalAgentsMd";
import { Button } from "../app-button";

export function SettingsPersonalization() {
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
      <SettingsGlobalAgentsMd />
      <SettingsSection
        title={t("memory.title")}
        description={t("memory.description")}
      >
        <SettingsCard>
          <SettingsRow
            title={t("memory.enableLocal")}
            description={t("memory.enableLocalDesc")}
            control={
              <SettingsSwitch
                testId="memory-toggle"
                label={t("memory.enableLocal")}
                checked={enabled}
                disabled={isBusy}
                onChange={() => void handleToggle()}
              />
            }
          />
          <SettingsRow
            title={t("memory.deleteLocal")}
            description={t("memory.deleteLocalDesc")}
            control={
              <Button variant="ghost"
                onClick={() => setPendingDelete(true)}
                disabled={isBusy}
                className="rounded-control border border-destructive/40 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60 h-auto"
              >
                {t("memory.deleteAction")}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      {status && (
        <div className="rounded-lg border border-border/60 bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
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
