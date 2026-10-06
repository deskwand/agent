/**
 * @module renderer/components/settings/OcrCapabilitySettings
 *
 * 「能力」区块里的本地 OCR。应用自带、需要下载模型、默认关 —— 三条都落在能力区。
 * 它不是 MCP 能力，所以不混进 connectors 的 entries 列表。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useOcrInstall } from "../../hooks/useOcrInstall";
import {
  InstallProgress,
  installStatusLabel,
  isInstalling,
  SettingsCard,
  SettingsRow,
  SettingsStatusBadge,
  SettingsSwitch,
} from "./shared";

export function OcrCapabilitySettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [removing, setRemoving] = useState(false);
  const { install } = useOcrInstall();

  const enabled = appConfig?.ocr?.enabled === true;
  const installed = install?.installed === true;
  const busy = isInstalling(install);
  const status = installStatusLabel(t, install);

  /** 与语音同一条管线：写 AppConfig，再同步 store。 */
  const toggle = async (next: boolean) => {
    const saved = await window.electronAPI?.config.save({
      ocr: { enabled: next },
    });
    if (saved?.config) setAppConfig(saved.config);
    // 打开即开始下载。已装好时不再调用 —— 装好的调用只会白推一条进度事件。
    if (next && !installed) void window.electronAPI?.ocr.install();
  };

  const remove = async () => {
    setRemoving(true);
    try {
      // 不本地猜结果：主进程成功推 idle、失败推 error
      await window.electronAPI?.ocr.removeInstall();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <SettingsCard>
      <SettingsRow
        testId="capability-ocr"
        title={t("settings.capabilities.ocr.title")}
        description={t("settings.capabilities.ocr.desc")}
        control={
          <SettingsSwitch
            checked={enabled}
            label={t("settings.capabilities.ocr.title")}
            testId="ocr-enable"
            onChange={(next) => void toggle(next)}
          />
        }
      />

      {enabled && (
        <SettingsRow
          testId="ocr-model"
          sub
          title={t("settings.capabilities.ocr.model")}
          badge={
            <SettingsStatusBadge
              testId="ocr-model-badge"
              tone={status.tone}
              label={status.label}
            />
          }
          note={t("settings.capabilities.memoryNote")}
          control={
            installed ? (
              <button
                type="button"
                data-testid="ocr-remove"
                aria-label={t("settings.capabilities.ocr.remove")}
                disabled={removing}
                onClick={() => void remove()}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              >
                {t("settings.capabilities.install.delete")}
              </button>
            ) : (
              !busy && (
                <button
                  type="button"
                  data-testid="ocr-install"
                  aria-label={t("settings.capabilities.ocr.download")}
                  onClick={() => void window.electronAPI?.ocr.install()}
                  className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  {install?.phase === "error"
                    ? t("settings.capabilities.install.retry")
                    : t("settings.capabilities.install.download")}
                </button>
              )
            )
          }
        />
      )}

      {enabled && busy && (
        <InstallProgress
          percent={install?.percent ?? 0}
          testId="ocr-install-progress"
        />
      )}
    </SettingsCard>
  );
}
