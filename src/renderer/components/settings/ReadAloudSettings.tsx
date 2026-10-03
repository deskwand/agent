/**
 * @module renderer/components/settings/ReadAloudSettings
 *
 * 「能力」区块里的朗读。
 *
 * 放在这里与语音输入同一条理由：应用自带、默认关、有下载物。它不需要任何系统
 * 权限（不碰麦克风、不碰屏幕），所以不走 CapabilityPermissions 那一套。
 *
 * 卡片自身不带 `SettingsSection`：「本机功能」那个标题由 `VoiceCapabilitySettings`
 * 渲染，两张卡共用它，顺序是语音输入在前、朗读在后。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TtsInstallState } from "../../../shared/ipc-types";
import { useAppStore } from "../../store";
import { SettingsCard, SettingsRow, SettingsSwitch } from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

export function ReadAloudSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [install, setInstall] = useState<TtsInstallState | null>(null);
  const [removing, setRemoving] = useState(false);

  const enabled = appConfig?.readAloud?.enabled === true;
  const busy =
    install?.phase === "downloading" || install?.phase === "extracting";
  const installed = install?.installed === true;

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

  const statusText = busy
    ? t("settings.capabilities.readAloud.installing", {
        percent: install?.percent ?? 0,
      })
    : installed
      ? t("settings.capabilities.readAloud.installed")
      : install?.phase === "error"
        ? t("settings.capabilities.readAloud.installFailed")
        : t("settings.capabilities.readAloud.notInstalled");

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
          title={statusText}
          description={t("settings.capabilities.readAloud.memoryNote")}
          control={
            installed ? (
              <button
                type="button"
                data-testid="read-aloud-remove"
                disabled={removing}
                onClick={() => void remove()}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              >
                {t("settings.capabilities.readAloud.remove")}
              </button>
            ) : (
              !busy && (
                <button
                  type="button"
                  data-testid="read-aloud-install"
                  onClick={() => void window.electronAPI?.tts?.install()}
                  className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  {t("settings.capabilities.readAloud.install")}
                </button>
              )
            )
          }
        />
      )}
    </SettingsCard>
  );
}
