/**
 * @module renderer/components/settings/VoiceCapabilitySettings
 *
 * 「能力」区块里的语音输入。
 *
 * 放在这里而不放「设置 API」：它的定义是**应用自带 + 需要系统权限 + 默认关**，
 * 三条全中「能力」区块；一条都不沾「API 渠道配置」。
 *
 * 它不是 MCP 能力，所以**不混进 entries 列表**（那个列表来自
 * `connectors.list()` 的 mcp-builtin，开关走 `connectors.setEnabled`）。
 *
 * 布局用 `./shared` 的卡片原语（与 9fe760f「设置页对齐卡片行布局」那次重构一致），
 * 不手搓容器。权限行等子行由调用方通过 `children` 注入：它们属于这张卡，
 * 但不属于这个组件。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { VOICE_SHORTCUTS } from "../../../shared/voice-shortcuts";
import {
  settingsShortcutLabelKey,
  SHORTCUT_HINT_KEY,
  shortcutPlatform,
} from "../../voice-shortcut-labels";
import type { VoiceEngineConfig } from "../../types";
import { useAppStore } from "../../store";
import { useEmotionInstall } from "../../hooks/useEmotionInstall";
import { useVoiceEngine } from "../../hooks/useVoiceEngine";
import {
  InstallProgress,
  installStatusLabel,
  isInstalling,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsStatusBadge,
  SettingsSwitch,
} from "./shared";
import { Button } from "../app-button";

export function VoiceCapabilitySettings({
  children,
}: {
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [removing, setRemoving] = useState(false);
  // 安装态与聊天页共用一份订阅（见 useVoiceEngine）。
  const { install } = useVoiceEngine();
  // 情感识别是另一个安装单元：订阅独立，失败互不影响。
  const emotion = useEmotionInstall();
  const emotionEnabled = appConfig?.voiceEmotion?.enabled === true;

  const engine = appConfig?.voiceEngine;
  const enabled = engine?.enabled === true;
  const selectedShortcut = engine?.shortcut ?? "AltRight";
  // 选项文案带物理键名（「右 Option」在 Windows 上叫「右 Alt」），
  // 所以整张卡共用一次平台判断。
  const platform = shortcutPlatform(window.electronAPI?.platform);

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
      // 不本地猜结果：主进程成功推 idle、失败推 error（失败时还带真实的已装状态）。
      await window.electronAPI?.voice.removeInstall();
    } finally {
      setRemoving(false);
    }
  };

  const busy = isInstalling(install);
  const installed = install?.installed === true;
  const status = installStatusLabel(t, install);
  const emotionStatus = installStatusLabel(t, emotion.state);

  const saveEmotion = async (next: boolean) => {
    if (!window.electronAPI) return;
    const saved = await window.electronAPI.config.save({
      voiceEmotion: { enabled: next },
    });
    if (saved?.config) setAppConfig(saved.config);
    // 打开即开始安装（已装好时不再调用）。
    if (next && !emotion.installed) void emotion.install();
  };

  return (
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
          sub
          title={t("settings.capabilities.voice.model")}
          badge={
            <SettingsStatusBadge
              testId="voice-engine-badge"
              tone={status.tone}
              label={status.label}
            />
          }
          note={t("settings.capabilities.memoryNote")}
          control={
            installed ? (
              <Button
                variant="ghost"
                type="button"
                data-testid="voice-remove"
                aria-label={t("settings.capabilities.voice.remove")}
                disabled={removing}
                onClick={() => void remove()}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 h-auto"
              >
                {t("settings.capabilities.install.delete")}
              </Button>
            ) : (
              !busy && (
                <Button
                  variant="ghost"
                  type="button"
                  data-testid="voice-install"
                  aria-label={t("settings.capabilities.voice.download")}
                  onClick={() => void window.electronAPI?.voice.install()}
                  className="rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                >
                  {install?.phase === "error"
                    ? t("settings.capabilities.install.retry")
                    : t("settings.capabilities.install.download")}
                </Button>
              )
            )
          }
        />
      )}

      {enabled && busy && (
        <InstallProgress
          percent={install?.percent ?? 0}
          testId="voice-install-progress"
        />
      )}

      {enabled && (
        <SettingsRow
          testId="emotion-engine"
          sub
          title={t("settings.capabilities.voice.emotionTitle")}
          note={t("settings.capabilities.voice.emotionDesc")}
          badge={
            <SettingsStatusBadge
              testId="emotion-engine-badge"
              tone={emotionStatus.tone}
              label={emotionStatus.label}
            />
          }
          control={
            emotion.installed ? (
              <Button
                variant="ghost"
                type="button"
                data-testid="emotion-remove"
                aria-label={t("settings.capabilities.voice.emotionTitle")}
                disabled={emotion.busy}
                onClick={() => {
                  // 删了模型就把开关也回到关：不然配置里留着 enabled，下次开机白等一次安装。
                  void emotion.remove().then(() => saveEmotion(false));
                }}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 h-auto"
              >
                {t("settings.capabilities.install.delete")}
              </Button>
            ) : (
              !emotion.busy && (
                <Button
                  variant="ghost"
                  type="button"
                  data-testid="emotion-install"
                  aria-label={t("settings.capabilities.voice.emotionTitle")}
                  onClick={() => void emotion.install()}
                  className="rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 h-auto"
                >
                  {emotion.error
                    ? t("settings.capabilities.install.retry")
                    : t("settings.capabilities.install.download")}
                </Button>
              )
            )
          }
        />
      )}

      {enabled && emotion.busy && (
        <InstallProgress
          percent={emotion.state?.percent ?? 0}
          testId="emotion-install-progress"
        />
      )}

      {enabled && emotion.installed && (
        <SettingsRow
          testId="emotion-enabled"
          sub
          title={t("settings.capabilities.voice.emotionEnable")}
          note={
            emotion.state?.last
              ? t("settings.capabilities.voice.emotionLastResult", {
                  label: emotion.state.last.label,
                  confidence: emotion.state.last.confidence.toFixed(2),
                })
              : undefined
          }
          control={
            <SettingsSwitch
              checked={emotionEnabled}
              label={t("settings.capabilities.voice.emotionEnable")}
              testId="emotion-enable"
              onChange={(next) => void saveEmotion(next)}
            />
          }
        />
      )}

      {enabled && (
        <SettingsRow
          testId="voice-shortcut"
          sub
          title={t("settings.capabilities.voice.shortcut")}
          // 选「不使用快捷键」时没有键在监听，这句会成为假话（同 VoiceMicButton 的规矩）。
          note={
            selectedShortcut === "disabled" ? undefined : t(SHORTCUT_HINT_KEY)
          }
          control={
            <SettingsSelect
              testId="voice-shortcut-select"
              label={t("settings.capabilities.voice.shortcut")}
              value={selectedShortcut}
              options={VOICE_SHORTCUTS.map((shortcut) => ({
                value: shortcut,
                label: t(settingsShortcutLabelKey(shortcut, platform)),
              }))}
              onChange={(next) => void save({ shortcut: next })}
            />
          }
        />
      )}
      {enabled && (
        <SettingsRow
          testId="voice-auto-polish"
          sub
          title={t("settings.capabilities.voice.autoPolish")}
          note={t("settings.capabilities.voice.autoPolishDesc")}
          control={
            <SettingsSwitch
              checked={engine?.autoPolish !== false}
              label={t("settings.capabilities.voice.autoPolish")}
              testId="voice-auto-polish-switch"
              onChange={(next) => void save({ autoPolish: next })}
            />
          }
        />
      )}
      {/* 权限行等子行由调用方注入：它们属于这张卡，但不属于这个组件。 */}
      {children}
    </SettingsCard>
  );
}
