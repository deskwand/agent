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
 *
 * 两个模型各占一行：中文音色（含英文术语）与英文音色（母语发音）。它们互相独立 ——
 * 只装英文也能读英文段落，删一个不动另一个。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TtsInstallState,
  TtsInstallStates,
  TtsModelKey,
} from "../../../shared/ipc-types";
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

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };

interface RowIds {
  row: string;
  badge: string;
  install: string;
  remove: string;
  progress: string;
}

const ROW_IDS: Record<TtsModelKey, RowIds> = {
  zh: {
    row: "read-aloud-state",
    badge: "read-aloud-badge",
    install: "read-aloud-install",
    remove: "read-aloud-remove",
    progress: "read-aloud-progress",
  },
  en: {
    row: "read-aloud-en-state",
    badge: "read-aloud-en-badge",
    install: "read-aloud-en-install",
    remove: "read-aloud-en-remove",
    progress: "read-aloud-en-progress",
  },
};

export function ReadAloudSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [states, setStates] = useState<TtsInstallStates | null>(null);
  const [removing, setRemoving] = useState<TtsModelKey | null>(null);

  const enabled = appConfig?.readAloud?.enabled === true;
  const rowOf = (model: TtsModelKey) => states?.[model] ?? IDLE;

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      // preload 在浏览器模式与测试里可能只有一部分字段：取不到就停在「未安装」，
      // 下载按钮仍然可用，用户能自愈。
      setStates((await window.electronAPI?.tts?.getInstallState()) ?? null);
    } catch {
      setStates(null);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void refresh();
    return window.electronAPI?.tts?.onEvent((event) => {
      if (event.type !== "install") return;
      // 两行各自更新：只更新第一行会让英文行的进度永远不动
      setStates((prev) => ({
        zh: prev?.zh ?? IDLE,
        en: prev?.en ?? IDLE,
        [event.model]: event.state,
      }));
    });
  }, [refresh]);

  /** 与 VoiceCapabilitySettings 同一条管线：写 AppConfig，再同步 store。 */
  const toggle = async (next: boolean) => {
    const saved = await window.electronAPI?.config?.save({
      readAloud: { enabled: next },
    });
    if (saved?.config) setAppConfig(saved.config);
    // 打开即开始下载中文模型（已发布的默认行为）。已经装好时不再调用：
    // 装好的调用只会白推一条进度事件。英文行由用户自己点。
    if (next && !rowOf("zh").installed)
      void window.electronAPI?.tts?.install("zh");
  };

  const remove = async (model: TtsModelKey) => {
    setRemoving(model);
    try {
      await window.electronAPI?.tts?.removeInstall(model);
      // 删完重新读一次：删失败时留着原状态，界面才不会声称「已删除」。
      await refresh();
    } finally {
      setRemoving(null);
    }
  };

  const modelRow = (model: TtsModelKey) => {
    const ids = ROW_IDS[model];
    const row = rowOf(model);
    const busy = isInstalling(row);
    const status = installStatusLabel(t, row);
    const zh = model === "zh";

    return (
      <SettingsRow
        key={model}
        testId={ids.row}
        sub
        title={t(
          zh
            ? "settings.capabilities.readAloud.modelZh"
            : "settings.capabilities.readAloud.modelEn",
        )}
        badge={
          <SettingsStatusBadge
            testId={ids.badge}
            tone={status.tone}
            label={status.label}
          />
        }
        note={t(
          zh
            ? "settings.capabilities.memoryNote"
            : "settings.capabilities.readAloud.enNote",
        )}
        control={
          row.installed ? (
            <button
              type="button"
              data-testid={ids.remove}
              aria-label={t(
                zh
                  ? "settings.capabilities.readAloud.removeZh"
                  : "settings.capabilities.readAloud.removeEn",
              )}
              disabled={removing === model}
              onClick={() => void remove(model)}
              className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              {t("settings.capabilities.install.delete")}
            </button>
          ) : (
            !busy && (
              <button
                type="button"
                data-testid={ids.install}
                aria-label={t(
                  zh
                    ? "settings.capabilities.readAloud.downloadZh"
                    : "settings.capabilities.readAloud.downloadEn",
                )}
                onClick={() => void window.electronAPI?.tts?.install(model)}
                className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                {row.phase === "error"
                  ? t("settings.capabilities.install.retry")
                  : t("settings.capabilities.install.download")}
              </button>
            )
          )
        }
      />
    );
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

      {enabled && modelRow("zh")}
      {enabled && isInstalling(rowOf("zh")) && (
        <InstallProgress
          percent={rowOf("zh").percent}
          testId={ROW_IDS.zh.progress}
        />
      )}

      {enabled && modelRow("en")}
      {enabled && isInstalling(rowOf("en")) && (
        <InstallProgress
          percent={rowOf("en").percent}
          testId={ROW_IDS.en.progress}
        />
      )}
    </SettingsCard>
  );
}
