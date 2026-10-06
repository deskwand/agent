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
 * 「音色」行是**两档模式，各带自己那份模型**：
 * - 快速 → 高速音色（matcha，123MB），只在语音对话里用；
 * - 均衡 → 中文音色（zh，157MB），与「朗读」共用同一份。
 *
 * 所以徽标、下载、删除都跟**当前选中的模式**走：选谁就显示谁那份模型的状态。
 * 与朗读卡不是两份 157MB，而是一份模型的两个视图 —— 在任一边删掉，两边都会变成
 * 「未安装」（两边都订阅同一批安装事件）。
 *
 * 旧版是一个「高速音色」开关，只有 matcha 一条路。它逼出一个前置条件：关掉时改用
 * 朗读音色，而那条路要先把朗读开关打开。两档模式没有这个前置条件 —— 主进程现在
 * 放行 `purpose: "voice"` 的调用（见 `src/main/tts/ipc.ts`）。
 *
 * 等待时长用下拉而不是滑杆：设置区没有滑杆控件，六档选择更好点中，也不必为一项设置
 * 引入新控件。音色也用下拉：两档各有名字（快速 / 均衡），而开关只能表达「是 / 否」。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TtsInstallState,
  TtsInstallStates,
  TtsModelKey,
} from "../../../shared/ipc-types";
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
} from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 六档覆盖从"急性子"到"慢条斯理"，两端就是 shared 里的夹取边界。 */
const SILENCE_CHOICES = ["400", "600", "800", "1000", "1500", "2000"] as const;

type SilenceChoice = (typeof SILENCE_CHOICES)[number];

const IDLE: TtsInstallState = { phase: "idle", percent: 0, installed: false };
const IDLE_STATES: TtsInstallStates = { zh: IDLE, en: IDLE, matcha: IDLE };

/** 两档模式。`fast` 用高速音色，`balanced` 用中文音色。 */
type Tone = "fast" | "balanced";

/**
 * 每档的三件事：用哪份模型，以及三个按钮的无障碍名称。
 *
 * 名称都要含住可见文字（「下载」/「重试」/「删除」），否则语音控制用户念不出这个
 * 按钮的名字（WCAG 2.5.3 Label in Name）。
 */
const TONE = {
  fast: {
    model: "matcha",
    download: "settings.capabilities.voiceMode.toneDownloadFast",
    retry: "settings.capabilities.voiceMode.toneRetryFast",
    remove: "settings.capabilities.voiceMode.toneRemoveFast",
  },
  balanced: {
    model: "zh",
    download: "settings.capabilities.voiceMode.toneDownloadZh",
    retry: "settings.capabilities.voiceMode.toneRetryZh",
    remove: "settings.capabilities.voiceMode.toneRemoveZh",
  },
} as const satisfies Record<
  Tone,
  { model: TtsModelKey; download: string; retry: string; remove: string }
>;

export function VoiceModeSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [states, setStates] = useState<TtsInstallStates | null>(null);
  const [removing, setRemoving] = useState(false);

  const current = String(
    appConfig?.voiceMode?.silenceMs ?? DEFAULT_VOICE_MODE.silenceMs,
  ) as SilenceChoice;

  const fastVoice =
    appConfig?.voiceMode?.fastVoice ?? DEFAULT_VOICE_MODE.fastVoice;
  const tone: Tone = fastVoice ? "fast" : "balanced";
  /** 徽标、下载、删除都看当前这一档的模型。 */
  const { model } = TONE[tone];
  const state = states?.[model] ?? IDLE;

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
      // 三个模型都收：当前显示哪一个由 `tone` 决定，切换时不必重读磁盘。
      if (event.type !== "install") return;
      setStates((prev) => ({
        ...(prev ?? IDLE_STATES),
        [event.model]: event.state,
      }));
    });
  }, [refresh]);

  const removeModel = async () => {
    setRemoving(true);
    try {
      await window.electronAPI?.tts?.removeInstall(model);
      // 删完重新读一次：删失败时留着原状态，界面才不会声称「已删除」
      await refresh();
    } finally {
      setRemoving(false);
    }
  };
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
   * 切模式就是下载入口（与朗读那个开关同一行为）：切到哪一档，缺那份模型就开始下。
   * 已装时不调 install：装好的调用只会白推一条进度事件。
   */
  const changeTone = async (next: Tone) => {
    if (!isElectron) return;
    await saveVoiceMode({ fastVoice: next === "fast" });
    const nextModel = TONE[next].model;
    if ((states?.[nextModel] ?? IDLE).installed) return;
    void window.electronAPI?.tts?.install(nextModel);
    // 主进程看到已装会**静默返回**、不推事件（`tts.install` 的按模型守卫）。
    // 两边状态不一致时，不重读的话这个按钮会一直停在「下载」上不动。
    void refresh();
  };

  const status = installStatusLabel(t, state);
  const busy = isInstalling(state);

  return (
    <SettingsCard>
      <SettingsRow
        testId="voice-mode-card"
        title={t("settings.capabilities.voiceMode.title")}
        description={t("settings.capabilities.voiceMode.desc")}
        control={
          <SettingsSelect<SilenceChoice>
            testId="voice-mode-silence"
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
        title={t("settings.capabilities.voiceMode.tone")}
        badge={
          <SettingsStatusBadge
            testId="voice-voice-badge"
            tone={status.tone}
            label={status.label}
          />
        }
        note={t("settings.capabilities.voiceMode.toneDesc")}
        control={
          <>
            <SettingsSelect<Tone>
              testId="voice-voice-tone"
              label={t("settings.capabilities.voiceMode.tone")}
              value={tone}
              options={[
                {
                  value: "fast",
                  label: t("settings.capabilities.voiceMode.toneFast"),
                },
                {
                  value: "balanced",
                  label: t("settings.capabilities.voiceMode.toneBalanced"),
                },
              ]}
              onChange={(next) => void changeTone(next)}
            />
            {state.installed ? (
              <button
                type="button"
                data-testid="voice-voice-remove"
                aria-label={t(TONE[tone].remove)}
                disabled={removing}
                onClick={() => void removeModel()}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              >
                {t("settings.capabilities.install.delete")}
              </button>
            ) : (
              !busy && (
                <button
                  type="button"
                  data-testid={
                    state.phase === "error"
                      ? "voice-voice-retry"
                      : "voice-voice-install"
                  }
                  aria-label={t(
                    state.phase === "error"
                      ? TONE[tone].retry
                      : TONE[tone].download,
                  )}
                  onClick={() => void window.electronAPI?.tts?.install(model)}
                  className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  {state.phase === "error"
                    ? t("settings.capabilities.install.retry")
                    : t("settings.capabilities.install.download")}
                </button>
              )
            )}
          </>
        }
      />

      {busy && (
        <InstallProgress
          percent={state.percent}
          testId="voice-voice-progress"
        />
      )}
    </SettingsCard>
  );
}
