/**
 * @module renderer/components/settings/VoiceCapabilitySettings
 *
 * 「能力」区块里的语音输入。
 *
 * 放在这里而不放「设置 API」：它的定义是**应用自带 + 需要系统权限 + 默认关**，
 * 三条全中「能力」区块；一条都不沾「API 渠道配置」。
 *
 * 它是「本机功能」，不是 MCP 能力，所以**不混进 entries 列表**（那个列表来自
 * `connectors.list()` 的 mcp-builtin，开关走 `connectors.setEnabled`）。
 * 见设计文档 §3.4。
 *
 * 布局用 `./shared` 的卡片原语（与 9fe760f「设置页对齐卡片行布局」那次重构一致），
 * 不手搓容器。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VoiceInstallState } from "../../../shared/ipc-types";
import {
  VOICE_SHORTCUTS,
  type VoiceShortcut,
} from "../../../shared/voice-shortcuts";
import type { VoiceEngineConfig } from "../../types";
import { useAppStore } from "../../store";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "./shared";

const SHORTCUT_LABEL_KEYS: Record<VoiceShortcut, string> = {
  AltRight: "settings.capabilities.voice.shortcutAltRight",
  AltSpace: "settings.capabilities.voice.shortcutAltSpace",
  MetaShiftSpace: "settings.capabilities.voice.shortcutMetaShiftSpace",
  disabled: "settings.capabilities.voice.shortcutDisabled",
};

export function VoiceCapabilitySettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [install, setInstall] = useState<VoiceInstallState | null>(null);
  const [removing, setRemoving] = useState(false);

  const engine = appConfig?.voiceEngine;
  const enabled = engine?.enabled === true;

  useEffect(() => {
    // 浏览器模式与测试里 preload 可能不完整：取不到就停在「未安装」，
    // 安装按钮仍然可用，用户能自愈。
    const voice = window.electronAPI?.voice;
    if (!voice) return;
    const unsubscribe = voice.onEvent((event) => {
      if (event.type === "install") setInstall(event.state);
    });
    void voice
      .getInstallState()
      .then(setInstall)
      .catch(() => {
        /* 读不到就按「未知」显示 */
      });
    return unsubscribe;
  }, []);

  /** 与 SettingsGeneral 的 codemode 同一条管线：写 AppConfig，再同步 store。 */
  const save = async (patch: Partial<VoiceEngineConfig>) => {
    if (!engine || !window.electronAPI) return;
    const saved = await window.electronAPI.config.save({
      voiceEngine: { ...engine, ...patch },
    });
    if (saved?.config) setAppConfig(saved.config);
  };

  const toggle = async (next: boolean) => {
    await save({ enabled: next });
    // 打开即开始安装。已经装好时不再调用：装好的调用只会白推一条进度事件。
    if (next && install?.installed !== true)
      void window.electronAPI?.voice.install();
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const result = await window.electronAPI?.voice.removeInstall();
      // 只在真删掉时才本地落定。删失败（Windows 上原生模型文件被映射占用）时
      // 留着原状态，否则界面会声称「已删除」而磁盘上还在。
      if (result?.ok) setInstall({ phase: "idle", percent: 0, installed: false });
    } finally {
      setRemoving(false);
    }
  };

  const busy =
    install?.phase === "downloading" || install?.phase === "extracting";
  const installed = install?.installed === true;

  const statusText = busy
    ? t("settings.capabilities.voice.installing", {
        percent: install?.percent ?? 0,
      })
    : installed
      ? t("settings.capabilities.voice.installed")
      : t("settings.capabilities.voice.notInstalled");

  return (
    <SettingsSection title={t("settings.capabilities.localFeatures")}>
      <SettingsCard>
        <SettingsRow
          testId="capability-voice"
          title={t("settings.capabilities.voice.title")}
          description={t("settings.capabilities.voice.desc")}
          control={
            <SettingsSwitch
              checked={enabled}
              label={t("settings.capabilities.voice.title")}
              testId="voice-enable"
              onChange={(next) => void toggle(next)}
            />
          }
        />

        {enabled && (
          <SettingsRow
            testId="voice-engine"
            title={statusText}
            note={
              install?.phase === "error"
                ? t("settings.capabilities.voice.installFailed")
                : t("settings.capabilities.voice.memoryNote")
            }
            control={
              installed ? (
                <button
                  type="button"
                  data-testid="voice-remove"
                  disabled={removing}
                  onClick={() => void remove()}
                  className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                >
                  {t("settings.capabilities.voice.remove")}
                </button>
              ) : (
                !busy && (
                  <button
                    type="button"
                    data-testid="voice-install"
                    onClick={() => void window.electronAPI?.voice.install()}
                    className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                  >
                    {t("settings.capabilities.voice.install")}
                  </button>
                )
              )
            }
          />
        )}

        {/* 进度条不是一行内容，所以直接放在卡片里而不是塞进 SettingsRow 的 control。 */}
        {enabled && busy && (
          <div className="px-4 pb-3" data-testid="voice-install-progress">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${install?.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {enabled && (
          <SettingsRow
            testId="voice-shortcut"
            title={t("settings.capabilities.voice.shortcut")}
            note={t("settings.capabilities.voice.shortcutFnHint")}
            control={
              <SettingsSelect
                label={t("settings.capabilities.voice.shortcut")}
                value={engine?.shortcut ?? "AltRight"}
                options={VOICE_SHORTCUTS.map((shortcut) => ({
                  value: shortcut,
                  label: t(SHORTCUT_LABEL_KEYS[shortcut]),
                }))}
                onChange={(next) => void save({ shortcut: next })}
              />
            }
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
