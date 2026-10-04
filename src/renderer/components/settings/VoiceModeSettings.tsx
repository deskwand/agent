/**
 * @module renderer/components/settings/VoiceModeSettings
 *
 * 「能力」区块里的语音对话。两个设置项：最多等多久、用哪个音色。
 *
 * 「最多等多久」的语义已经从"静音多久算说完"改成"**最多等你多久**"：说完了由句末标点
 * 判定，这个值退成硬上限 —— 判定说你没说完时，最多再等这么久就收尾。
 * 数值与档位刻意没动（400–2000ms、默认 1200），只改文案：改下限会造出一条
 * 静默迁移，而症状集并不要求放宽范围。
 *
 * 「音色」行是**高速音色唯一的安装入口**（语音模式浮层里不做提示，见设计 D4）：
 * 与朗读那两行同构 —— 状态徽标 + 下载 / 删除 + 进度条，共用同一套
 * `installStatusLabel` / `InstallProgress`。
 *
 * 用下拉而不是滑杆：设置区没有滑杆控件，六档选择更好点中，也不必为一项设置
 * 引入新控件。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TtsInstallState } from "../../../shared/ipc-types";
import { useAppStore } from "../../store";
import { DEFAULT_VOICE_MODE } from "../../../shared/voice-mode";
import {
  InstallProgress,
  installStatusLabel,
  isInstalling,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsStatusBadge,
} from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 六档覆盖从"急性子"到"慢条斯理"，两端就是 shared 里的夹取边界。 */
const SILENCE_CHOICES = ["400", "600", "800", "1000", "1500", "2000"] as const;

type SilenceChoice = (typeof SILENCE_CHOICES)[number];

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };

export function VoiceModeSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [fastVoice, setFastVoice] = useState<TtsInstallState>(IDLE);
  const [removing, setRemoving] = useState(false);

  const current = String(
    appConfig?.voiceMode?.silenceMs ?? DEFAULT_VOICE_MODE.silenceMs,
  ) as SilenceChoice;

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    try {
      const states = await window.electronAPI?.tts?.getInstallState();
      if (states?.matcha) setFastVoice(states.matcha);
    } catch {
      // 读不到就停在原地：下载按钮仍然可用，用户能自愈
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void refresh();
    return window.electronAPI?.tts?.onEvent((event) => {
      // 只认高速音色：朗读那两个模型的进度不归这一行
      if (event.type !== "install" || event.model !== "matcha") return;
      setFastVoice(event.state);
    });
  }, [refresh]);

  const removeFastVoice = async () => {
    setRemoving(true);
    try {
      await window.electronAPI?.tts?.removeInstall("matcha");
      // 删完重新读一次：删失败时留着原状态，界面才不会声称「已删除」
      await refresh();
    } finally {
      setRemoving(false);
    }
  };

  /** 与朗读、语音输入同一条管线：写 AppConfig，再同步 store。 */
  const change = async (next: SilenceChoice) => {
    if (!isElectron) return;
    const saved = await window.electronAPI?.config?.save({
      voiceMode: { silenceMs: Number(next) },
    });
    if (saved?.config) setAppConfig(saved.config);
  };

  const status = installStatusLabel(t, fastVoice);
  const busy = isInstalling(fastVoice);

  return (
    <SettingsCard>
      <SettingsRow
        testId="voice-mode-card"
        title={t("settings.capabilities.voiceMode.title")}
        description={t("settings.capabilities.voiceMode.desc")}
        control={
          <SettingsSelect<SilenceChoice>
            label={t("settings.capabilities.voiceMode.silenceLabel")}
            value={current}
            options={SILENCE_CHOICES.map((value) => ({
              value,
              label: t("settings.capabilities.voiceMode.silenceValue", {
                ms: value,
              }),
            }))}
            onChange={(next) => void change(next)}
          />
        }
      />

      <SettingsRow
        sub
        testId="voice-voice-row"
        title={t("settings.capabilities.voiceMode.voiceFast")}
        badge={
          <SettingsStatusBadge
            testId="voice-voice-badge"
            tone={status.tone}
            label={status.label}
          />
        }
        note={t("settings.capabilities.voiceMode.voiceFastDesc")}
        control={
          fastVoice.installed ? (
            <button
              type="button"
              data-testid="voice-voice-remove"
              aria-label={t("settings.capabilities.voiceMode.voiceFastRemove")}
              disabled={removing}
              onClick={() => void removeFastVoice()}
              className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              {t("settings.capabilities.install.delete")}
            </button>
          ) : (
            !busy && (
              <button
                type="button"
                data-testid="voice-voice-install"
                aria-label={t(
                  "settings.capabilities.voiceMode.voiceFastDownload",
                )}
                onClick={() => void window.electronAPI?.tts?.install("matcha")}
                className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                {fastVoice.phase === "error"
                  ? t("settings.capabilities.install.retry")
                  : t("settings.capabilities.install.download")}
              </button>
            )
          )
        }
      />

      {busy && (
        <InstallProgress
          percent={fastVoice.percent}
          testId="voice-voice-progress"
        />
      )}
    </SettingsCard>
  );
}
