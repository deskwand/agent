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
 * 「音色」行是**三档模式，各带自己那份模型**：
 * - 快速 → 高速音色（matcha，123MB），只在语音对话里用；
 * - 均衡 → 中文音色（zh，157MB），与「朗读」共用同一份；
 * - 最佳音质 → 本机的大模型（约 900MB，需要单独安装，卸载与安装都在它自己那一行）。
 *
 * 前两档的徽标、下载、删除都跟**当前选中的模式**走：选谁就显示谁那份模型的状态。
 * 与朗读卡不是两份 157MB，而是一份模型的两个视图 —— 在任一边删掉，两边都会变成
 * 「未安装」（两边都订阅同一批安装事件）。
 *
 * 第三档有一处**有意偏离惯例**：切到它**不开始下载**。前两档"切档即下载"是合理的
 * （一份 157MB），但 900MB 不该被一个下拉静默触发 —— 它要用户点「安装」。
 *
 * 三档都能**试听**：9 个音色光看名字选不出来（"ono_anna" 是什么声音？）。
 *
 * 旧版是一个「高速音色」开关，只有 matcha 一条路。它逼出一个前置条件：关掉时改用
 * 朗读音色，而那条路要先把朗读开关打开。多档模式没有这个前置条件 —— 主进程现在
 * 放行 `purpose: "voice"` 的调用（见 `src/main/tts/ipc.ts`）。
 *
 * 等待时长用下拉而不是滑杆：设置区没有滑杆控件，六档选择更好点中，也不必为一项设置
 * 引入新控件。音色也用下拉：档位各有名字，而开关只能表达「是 / 否」。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TtsInstallState,
  TtsInstallStates,
  TtsModelKey,
  TtsTone,
} from "../../../shared/ipc-types";
import {
  ENGINE_VOICES,
  ENGINE_VOICE_DEFAULT,
  type EngineInstallState,
} from "../../../shared/engine-install";
import { useAppStore } from "../../store";
import {
  DEFAULT_VOICE_MODE,
  resolveVoiceTone,
} from "../../../shared/voice-mode";
import type { VoiceModeConfig } from "../../../shared/voice-mode";
import { useTtsPreview } from "../../hooks/useTtsPreview";
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
const IDLE_ENGINE: EngineInstallState = {
  phase: "idle",
  percent: 0,
  installed: false,
};

const VOICE_MODE_KEY = "settings.capabilities.voiceMode";

/**
 * 每档的三件事：用哪份模型，以及三个按钮的无障碍名称。
 *
 * 名称都要含住可见文字（「下载」/「重试」/「删除」），否则语音控制用户念不出这个
 * 按钮的名字（WCAG 2.5.3 Label in Name）。
 *
 * `best` 没有 `model` —— 引擎不是 sherpa 的模型，它有自己的行与自己的三个按钮。
 */
const TONE = {
  fast: {
    kind: "sherpa",
    model: "matcha",
    download: `${VOICE_MODE_KEY}.toneDownloadFast`,
    retry: `${VOICE_MODE_KEY}.toneRetryFast`,
    remove: `${VOICE_MODE_KEY}.toneRemoveFast`,
  },
  balanced: {
    kind: "sherpa",
    model: "zh",
    download: `${VOICE_MODE_KEY}.toneDownloadZh`,
    retry: `${VOICE_MODE_KEY}.toneRetryZh`,
    remove: `${VOICE_MODE_KEY}.toneRemoveZh`,
  },
  best: { kind: "engine" },
} as const satisfies Record<
  TtsTone,
  | {
      kind: "sherpa";
      model: TtsModelKey;
      download: string;
      retry: string;
      remove: string;
    }
  | { kind: "engine" }
>;

/** 音量条的三种状态共用一套外观。 */
const GHOST_BUTTON =
  "rounded-control border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50";
const PRIMARY_BUTTON =
  "rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50";

export function VoiceModeSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [states, setStates] = useState<TtsInstallStates | null>(null);
  const [engine, setEngine] = useState<EngineInstallState | null>(null);
  const [removing, setRemoving] = useState(false);
  const preview = useTtsPreview();

  const current = String(
    appConfig?.voiceMode?.silenceMs ?? DEFAULT_VOICE_MODE.silenceMs,
  ) as SilenceChoice;

  // `tone` 是事实来源（老配置只有 fastVoice，由 resolveVoiceTone 归一化）
  const storedTone = resolveVoiceTone(appConfig?.voiceMode);
  /**
   * 平台不支持（清单里没有这一平台的产物）时**整档都不出现** —— 拿一个永远装不了的
   * 东西勾人只会制造"我为什么不能装"。
   *
   * 与"磁盘/内存不够"区别对待：那是用户能改的，所以保留档位并说明原因。
   * 只在**确知**平台不支持时才藏（判据来自主进程的预检）；读状态失败时照旧显示，
   * 免得一次瞬时错误把能用的功能藏起来。
   */
  const platformUnsupported =
    (engine?.blockedReason ?? undefined) === "platform";
  // 老配置写着 best、但这台机器装不了 → 按实际会发生的行为显示（主进程也会回退均衡）
  const tone =
    platformUnsupported && storedTone === "best" ? "balanced" : storedTone;
  const entry = TONE[tone];
  const isBest = entry.kind === "engine";
  /** 前两档的模型。best 时这一行不显示 sherpa 的状态，取 zh 只是为了让类型收敛。 */
  const model: TtsModelKey = entry.kind === "sherpa" ? entry.model : "zh";
  const state = states?.[model] ?? IDLE;
  const engineState = engine ?? IDLE_ENGINE;
  /** 徽标与进度条看**当前这一档**。 */
  const active = isBest ? engineState : state;
  const busy = isInstalling(active);
  const engineVoice =
    appConfig?.voiceMode?.voiceEngineVoice ?? ENGINE_VOICE_DEFAULT;
  const engineBlocked = isBest ? engineState.blockedReason : undefined;
  /**
   * 连续崩到上限被标记 failed：装是装了，但要**说出来并给一条路**（设计 §6）。
   * 没有这个的话，用户看到"已安装/就绪"、听到的是均衡音色，除了删掉重下 900MB
   * 没有任何入口能修。
   */
  const engineFailed =
    isBest && engineState.installed && engineState.status === "failed";

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

  const refreshEngine = useCallback(async () => {
    if (!isElectron) return;
    try {
      setEngine((await window.electronAPI?.tts?.getEngineState()) ?? null);
    } catch {
      setEngine(null);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void refresh();
    void refreshEngine();
    return window.electronAPI?.tts?.onEvent((event) => {
      // 引擎那条事件没有 model 键，单独收
      if (event.type === "engine") {
        setEngine(event.state);
        return;
      }
      // 三个模型都收：当前显示哪一个由 `tone` 决定，切换时不必重读磁盘。
      setStates((prev) => ({
        ...(prev ?? IDLE_STATES),
        [event.model]: event.state,
      }));
    });
  }, [refresh, refreshEngine]);

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

  const retryEngine = async () => {
    await window.electronAPI?.tts?.retryEngine();
    await refreshEngine();
  };

  const removeEngine = async () => {
    setRemoving(true);
    try {
      preview.stop(); // 删了引擎还留着试听的缓冲没有意义
      await window.electronAPI?.tts?.removeEngine();
      await refreshEngine();
    } finally {
      setRemoving(false);
    }
  };
  /**
   * 写 `voiceMode` 是**整体替换**，所以每次写入都必须带上另一个字段。
   * 只发 `{ silenceMs }` 会把 `tone` 归一化成默认值 —— 也就是这个下拉会
   * 替用户把档位换掉。所有 `voiceMode` 的写入都走这里。
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
   * 切档。前两档仍然是**下载入口**（切到哪一档，缺那份模型就开始下，与朗读那个
   * 开关同一行为）；第三档**有意例外** —— 900MB 不该被一个下拉静默触发，它只
   * 记住选择，安装由用户点那一行的「安装」。
   *
   * 已装时不调 install：装好的调用只会白推一条进度事件。
   */
  const changeTone = async (next: TtsTone) => {
    if (!isElectron) return;
    preview.stop(); // 换了档，上一档的声音不该还在响
    await saveVoiceMode({ tone: next, fastVoice: next === "fast" });
    const nextEntry = TONE[next];
    if (nextEntry.kind !== "sherpa") return;
    if ((states?.[nextEntry.model] ?? IDLE).installed) return;
    void window.electronAPI?.tts?.install(nextEntry.model);
    // 主进程看到已装会**静默返回**、不推事件（`tts.install` 的按模型守卫）。
    // 两边状态不一致时，不重读的话这个按钮会一直停在「下载」上不动。
    void refresh();
  };

  const installEngine = async () => {
    await window.electronAPI?.tts?.installEngine();
    await refreshEngine();
  };

  const status = installStatusLabel(t, active);
  /**
   * 徽标文案。`installStatusLabel` 先判 `installed`，所以"装了但被判 failed"会显示成
   * 「已安装」—— 那是在说谎（用户听到的是均衡音色）。这两档失败状态在这里覆盖它。
   */
  const badgeLabel = engineFailed
    ? t("settings.capabilities.install.failed")
    : engineBlocked
      ? t(`${VOICE_MODE_KEY}.toneBestBlocked`)
      : status.label;
  const badgeTone = engineFailed
    ? ("error" as const)
    : engineBlocked
      ? ("muted" as const)
      : status.tone;

  /** 试听：三档共用一颗按钮，标签随播放状态变。 */
  const previewButton = (which: TtsTone) => (
    <button
      type="button"
      data-testid={`voice-preview-${which}`}
      aria-label={t(
        preview.state === "playing"
          ? `${VOICE_MODE_KEY}.tonePreviewStop`
          : `${VOICE_MODE_KEY}.tonePreview`,
      )}
      disabled={preview.state === "busy"}
      onClick={() => {
        if (preview.state === "playing") preview.stop();
        else void preview.play(which);
      }}
      className={GHOST_BUTTON}
    >
      {preview.state === "busy"
        ? t(`${VOICE_MODE_KEY}.tonePreviewBusy`)
        : preview.state === "playing"
          ? t(`${VOICE_MODE_KEY}.tonePreviewStop`)
          : t(`${VOICE_MODE_KEY}.tonePreview`)}
    </button>
  );

  return (
    <SettingsCard>
      <SettingsRow
        testId="voice-mode-card"
        title={t(`${VOICE_MODE_KEY}.title`)}
        description={t(`${VOICE_MODE_KEY}.desc`)}
        control={
          <SettingsSelect<SilenceChoice>
            testId="voice-mode-silence"
            label={t(`${VOICE_MODE_KEY}.silenceLabel`)}
            value={current}
            options={SILENCE_CHOICES.map((value) => ({
              value,
              label: t(`${VOICE_MODE_KEY}.silenceValue`, { ms: value }),
            }))}
            onChange={(next) => void change(next)}
          />
        }
      />

      <SettingsRow
        sub
        testId="voice-voice-row"
        title={t(`${VOICE_MODE_KEY}.tone`)}
        badge={
          <SettingsStatusBadge
            testId="voice-voice-badge"
            tone={badgeTone}
            label={badgeLabel}
          />
        }
        note={t(
          platformUnsupported
            ? `${VOICE_MODE_KEY}.toneDescNoBest`
            : `${VOICE_MODE_KEY}.toneDesc`,
        )}
        control={
          <>
            <SettingsSelect<TtsTone>
              testId="voice-voice-tone"
              label={t(`${VOICE_MODE_KEY}.tone`)}
              value={tone}
              options={[
                { value: "fast", label: t(`${VOICE_MODE_KEY}.toneFast`) },
                {
                  value: "balanced",
                  label: t(`${VOICE_MODE_KEY}.toneBalanced`),
                },
                ...(platformUnsupported
                  ? []
                  : [
                      {
                        value: "best" as const,
                        label: t(`${VOICE_MODE_KEY}.toneBest`),
                      },
                    ]),
              ]}
              onChange={(next) => void changeTone(next)}
            />
            {/* 第三档的声音选择、试听与安装都在下面它自己那一行 */}
            {!isBest && state.installed && previewButton(tone)}
            {!isBest &&
              (state.installed ? (
                <button
                  type="button"
                  data-testid="voice-voice-remove"
                  aria-label={t(entry.kind === "sherpa" ? entry.remove : "")}
                  disabled={removing}
                  onClick={() => void removeModel()}
                  className={GHOST_BUTTON}
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
                        ? entry.kind === "sherpa"
                          ? entry.retry
                          : ""
                        : entry.kind === "sherpa"
                          ? entry.download
                          : "",
                    )}
                    onClick={() => void window.electronAPI?.tts?.install(model)}
                    className={PRIMARY_BUTTON}
                  >
                    {state.phase === "error"
                      ? t("settings.capabilities.install.retry")
                      : t("settings.capabilities.install.download")}
                  </button>
                )
              ))}
          </>
        }
      />

      {isBest && !platformUnsupported && (
        <SettingsRow
          sub
          testId="voice-engine-row"
          title={t(`${VOICE_MODE_KEY}.toneBestTitle`)}
          badge={
            <SettingsStatusBadge
              testId="voice-engine-badge"
              tone={engineBlocked ? "muted" : status.tone}
              label={badgeLabel}
            />
          }
          note={
            engineFailed
              ? t(`${VOICE_MODE_KEY}.toneBestFailedNote`)
              : engineBlocked
                ? t(`${VOICE_MODE_KEY}.toneBestBlockedNote`, {
                    reason: t(
                      `${VOICE_MODE_KEY}.${
                        engineBlocked === "disk"
                          ? "toneBestBlockedDisk"
                          : engineBlocked === "memory"
                            ? "toneBestBlockedMemory"
                            : "toneBestBlockedPlatform"
                      }`,
                    ),
                  })
                : t(`${VOICE_MODE_KEY}.toneBestNote`)
          }
          control={
            <>
              <SettingsSelect<string>
                testId="voice-engine-voice"
                label={t(`${VOICE_MODE_KEY}.toneBestVoice`)}
                value={engineVoice}
                disabled={!engineState.installed}
                options={
                  engineState.installed
                    ? ENGINE_VOICES.map((voice) => ({
                        value: voice.id,
                        label: voice.dialect
                          ? `${voice.id} · ${t(`${VOICE_MODE_KEY}.${voice.dialect}`)}`
                          : voice.id,
                      }))
                    : [
                        {
                          value: engineVoice,
                          label: t(
                            `${VOICE_MODE_KEY}.toneBestVoicePlaceholder`,
                          ),
                        },
                      ]
                }
                onChange={(next) =>
                  void saveVoiceMode({ voiceEngineVoice: next })
                }
              />
              {engineState.installed && previewButton("best")}
              {engineState.installed && engineFailed && (
                <button
                  type="button"
                  data-testid="voice-engine-reset"
                  aria-label={t(`${VOICE_MODE_KEY}.toneBestRetryFailed`)}
                  disabled={removing}
                  onClick={() => void retryEngine()}
                  className={PRIMARY_BUTTON}
                >
                  {t("settings.capabilities.install.retry")}
                </button>
              )}
              {engineState.installed ? (
                <button
                  type="button"
                  data-testid="voice-engine-remove"
                  aria-label={t(`${VOICE_MODE_KEY}.toneBestRemove`)}
                  disabled={removing}
                  onClick={() => void removeEngine()}
                  className={GHOST_BUTTON}
                >
                  {t("settings.capabilities.install.delete")}
                </button>
              ) : (
                !busy &&
                !engineBlocked && (
                  <button
                    type="button"
                    data-testid={
                      engineState.phase === "error"
                        ? "voice-engine-retry"
                        : "voice-engine-install"
                    }
                    aria-label={t(
                      `${VOICE_MODE_KEY}.${
                        engineState.phase === "error"
                          ? "toneBestRetry"
                          : "toneBestInstall"
                      }`,
                    )}
                    onClick={() => void installEngine()}
                    className={PRIMARY_BUTTON}
                  >
                    {engineState.phase === "error"
                      ? t("settings.capabilities.install.retry")
                      : t(`${VOICE_MODE_KEY}.toneBestInstall`)}
                  </button>
                )
              )}
            </>
          }
        />
      )}

      {busy && (
        <InstallProgress
          percent={active.percent}
          testId={isBest ? "voice-engine-progress" : "voice-voice-progress"}
        />
      )}

      {preview.error && (
        <div
          className="px-4 pb-3 text-xs text-error"
          data-testid="voice-preview-error"
        >
          {t(`${VOICE_MODE_KEY}.tonePreviewFailed`)}
        </div>
      )}
    </SettingsCard>
  );
}
