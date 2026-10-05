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
import type { VoiceModeConfig } from "../../../shared/voice-mode";
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

  /**
   * 开关显示的是什么：**装了（或正在装）才看偏好**。
   *
   * 不能写成 `checked = fastVoice`：默认偏好是 true，而新用户没装模型 ——
   * 那样开关会一开始就显示为开，而一个已经开着的开关没法启动下载
   * （新用户只能靠 off→on 才猜得到）。
   * `|| busy` 那半是为了下载期间不把开关弹回关。
   */
  const fastVoicePref =
    appConfig?.voiceMode?.fastVoice ?? DEFAULT_VOICE_MODE.fastVoice;

  /**
   * 写 `voiceMode` 是**整体替换**，所以每次写入都必须带上另一个字段。
   * 只发 `{ silenceMs }` 会把 `fastVoice` 归一化成默认值 —— 也就是这个下拉会
   * 替用户把开关打开。所有 `voiceMode` 的写入都走这里。
   *
   * 起始值在调用时现读 store（不用渲染时捕获的 `appConfig`）：两个控件连着拨时，
   * 渲染还没跟上，旧快照会把刚写进去的字段盖掉。
   */
  const saveVoiceMode = async (patch: Partial<VoiceModeConfig>) => {
    const current =
      useAppStore.getState().appConfig?.voiceMode ?? DEFAULT_VOICE_MODE;
    const saved = await window.electronAPI?.config?.save({
      voiceMode: { ...current, ...patch },
    });
    if (saved?.config) setAppConfig(saved.config);
  };

  /** 与朗读、语音输入同一条管线：写 AppConfig，再同步 store。 */
  const change = async (next: SilenceChoice) => {
    if (!isElectron) return;
    await saveVoiceMode({ silenceMs: Number(next) });
  };

  /**
   * 开关就是下载入口（与朗读那个开关同一行为）。已装时不调 install：
   * 装好的调用只会白推一条进度事件。
   */
  const toggleFastVoice = async (next: boolean) => {
    await saveVoiceMode({ fastVoice: next });
    if (next && !fastVoice.installed) {
      void window.electronAPI?.tts?.install("matcha");
    }
  };

  const status = installStatusLabel(t, fastVoice);
  const busy = isInstalling(fastVoice);
  /**
   * 开关是下载入口，所以"模型不在、也没在装、也没装失败"时它必须是关的 ——
   * 否则一个已经开着的开关没法启动下载（新用户只能靠 off→on 才猜得到）。
   *
   * 三个项各有理由：
   * - `installed`：装好了，开关就代表"用不用"（注意 `getInstallState` 在应用刚启动时
   *   `phase` 是 `idle`，所以这里不能用 `phase !== "idle"` 代替它）；
   * - `busy`：正在装，不把刚拨开的开关弹回去；
   * - `error`：装失败，意图还在，而且下面那个「重试」就是它的前提。
   */
  const switchReflectsPreference =
    fastVoice.installed || busy || fastVoice.phase === "error";
  const fastVoiceOn = switchReflectsPreference && fastVoicePref;

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
          <div className="flex items-center gap-2">
            <SettingsSwitch
              testId="voice-voice-toggle"
              label={t("settings.capabilities.voiceMode.voiceFastToggle")}
              checked={fastVoiceOn}
              onChange={(next) => void toggleFastVoice(next)}
            />
            {fastVoice.phase === "error" && fastVoicePref && (
              <button
                type="button"
                data-testid="voice-voice-retry"
                onClick={() => void window.electronAPI?.tts?.install("matcha")}
                className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                {t("settings.capabilities.install.retry")}
              </button>
            )}
            {fastVoice.installed && (
              <button
                type="button"
                data-testid="voice-voice-remove"
                aria-label={t(
                  "settings.capabilities.voiceMode.voiceFastRemove",
                )}
                disabled={removing}
                onClick={() => void removeFastVoice()}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              >
                {t("settings.capabilities.install.delete")}
              </button>
            )}
          </div>
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
