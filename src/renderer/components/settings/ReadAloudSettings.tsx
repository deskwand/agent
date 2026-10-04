/**
 * @module renderer/components/settings/ReadAloudSettings
 *
 * 「能力」区块里的朗读。
 *
 * 放在这里与语音输入同一条理由：应用自带、默认关、有下载物。它不需要任何系统
 * 权限（不碰麦克风、不碰屏幕），所以不走 CapabilityPermissions 那一套。
 *
 * 一张卡 = 一个能力，卡头就是它的名字；朗读今天没有系统权限，所以不接
 * `children`（权限行只注入有权限需求的那两张卡）。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TtsInstallState } from "../../../shared/ipc-types";
import { useAppStore } from "../../store";
import {
  InstallProgress,
  installStatusLabel,
  isInstalling,
  SettingsCard,
  SettingsRow,
  SettingsStatusBadge,
  SettingsSwitch,
} from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

export function ReadAloudSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [install, setInstall] = useState<TtsInstallState | null>(null);
  const [removing, setRemoving] = useState(false);

  const enabled = appConfig?.readAloud?.enabled === true;
  const busy = isInstalling(install);
  const installed = install?.installed === true;
  const status = installStatusLabel(t, install);

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      // preload 在浏览器模式与测试里可能只有一部分字段：取不到就停在「未安装」，
      // 下载按钮仍然可用，用户能自愈。
      setInstall((await window.electronAPI?.tts?.getInstallState()) ?? null);
    } catch {
      setInstall(null);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void refresh();
    return window.electronAPI?.tts?.onEvent((event) => {
      if (event.type === "install") setInstall(event.state);
    });
  }, [refresh]);

  /** 与 VoiceCapabilitySettings 同一条管线：写 AppConfig，再同步 store。 */
  const toggle = async (next: boolean) => {
    const saved = await window.electronAPI?.config?.save({
      readAloud: { enabled: next },
    });
    if (saved?.config) setAppConfig(saved.config);
    // 打开即开始下载。已经装好时不再调用：装好的调用只会白推一条进度事件。
    if (next && !installed) void window.electronAPI?.tts?.install();
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await window.electronAPI?.tts?.removeInstall();
      // 删完重新读一次：删失败时留着原状态，界面才不会声称「已删除」。
      await refresh();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <SettingsCard>
      <SettingsRow
        testId="read-aloud-card"
        title={t("settings.capabilities.readAloud.title")}
        description={t("settings.capabilities.readAloud.desc")}
        control={
          <SettingsSwitch
            checked={enabled}
            label={t("settings.capabilities.readAloud.title")}
            testId="read-aloud-toggle"
            onChange={(next) => void toggle(next)}
          />
        }
      />

      {enabled && (
        <SettingsRow
          testId="read-aloud-state"
          sub
          title={t("settings.capabilities.readAloud.model")}
          badge={
            <SettingsStatusBadge
              testId="read-aloud-badge"
              tone={status.tone}
              label={status.label}
            />
          }
          note={t("settings.capabilities.memoryNote")}
          control={
            installed ? (
              <button
                type="button"
                data-testid="read-aloud-remove"
                aria-label={t("settings.capabilities.readAloud.remove")}
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
                  data-testid="read-aloud-install"
                  aria-label={t("settings.capabilities.readAloud.download")}
                  onClick={() => void window.electronAPI?.tts?.install()}
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
          testId="read-aloud-progress"
        />
      )}
    </SettingsCard>
  );
}
