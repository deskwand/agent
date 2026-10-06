import { useEffect, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { VoiceInstallState } from "../../shared/ipc-types";
import { Tooltip } from "./Tooltip";
import type { VoiceInputController, VoiceStatus } from "../hooks/useVoiceInput";
import type { VoiceEngineConfig } from "../types";
import { holdKeyNameKey, shortcutPlatform } from "../voice-shortcut-labels";

export interface VoiceMicButtonProps {
  status: VoiceStatus;
  /** 0..1，录音时的实时响度。 */
  level: number;
  seconds: number;
  /**
   * 安装态。null / 缺省 = 没在装（或还没读到）。
   *
   * 可选：既有几个宿主替身只填了录音那几项，不该为了一个进度条去改它们。
   * 真正要守的是**接线**漏传 —— 那一条由`toMicButtonProps` 的必传参数拦下。
   */
  install?: VoiceInstallState | null;
  /**
   * 这段文字还有一次整理在等（`useVoiceInput` 的 `polishing`）。
   *
   * 可选：既有几个底栏替身只填了录音那几项，不该为一个环去改它们；接线漏传由
   * `toMicButtonProps` 拦下（那边的 `voice.polishing` 是必填字段）。缺省 = 不画环。
   */
  polishing?: boolean;
  /**
   * 「按住说话」的键名（已 i18n，如「右 Option」）。缺省 = 本气泡不提快捷键：
   * 引擎没启用，或用户在设置里选了「不使用快捷键」。
   */
  shortcutKeys?: string;
  onToggle: () => void;
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 波形槽位。固定 5 根，槽位号本身是常量，所以 key 不用数组序号。 */
const LEVEL_SLOTS = [0, 1, 2, 3, 4] as const;

/** 静音与空槽的保底高度（百分比）。不保底的话胶囊会半截空着。 */
const LEVEL_FLOOR = 12;

/**
 * 把最近 5 个电平采样摊成波形，最左最旧、最右最新，返回值是百分比高度。
 *
 * 电平每 100ms 才跳一次（采集 worklet 每 100ms 交一片音频），要读出「波形」只能靠
 * 时间差：5 根条各代表一个 100ms 采样。用同一个值乘 5 个系数只会让整块一起缩放 ——
 * 那是柱状图在抖，不是波形。
 */
function useLevelBars(level: number, active: boolean): number[] {
  const [samples, setSamples] = useState<number[]>([]);

  useEffect(() => {
    if (!active) {
      // 采样是这一次录音的产物，回 idle 就清空，下一轮从平地起步。
      setSamples((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    setSamples((prev) =>
      // 与上一个相同就不推：StrictMode 下 effect 会双跑，静止时也不该刷帧。
      // 代价是完全恒定的电平不会填满 5 根条 —— 真实 RMS 不会逐帧一模一样，够不着。
      prev[prev.length - 1] === level
        ? prev
        : [...prev, level].slice(-LEVEL_SLOTS.length),
    );
  }, [level, active]);

  const missing = Math.max(0, LEVEL_SLOTS.length - samples.length);
  const padded: number[] = [
    ...Array.from({ length: missing }, () => 0),
    ...samples,
  ];
  return padded.map((value) => Math.max(LEVEL_FLOOR, Math.round(value * 100)));
}

export function VoiceMicButton({
  status,
  level,
  seconds,
  install,
  polishing,
  shortcutKeys,
  onToggle,
}: VoiceMicButtonProps) {
  const { t } = useTranslation();
  const busy = status === "requesting" || status === "finishing";
  const installing =
    install?.phase === "downloading" || install?.phase === "extracting";
  const installFailed = install?.phase === "error";
  const percent = install?.percent ?? 0;
  // 但收尾中也要锁住麦克风：hook 里 toggle() 只认 idle/recording，
  // 不锁的话用户会点一个没反应的按钮。下载中同理：这一次点击不该被解释成录音。
  const micDisabled = busy || installing;
  const recording = status === "recording";
  /** 胶囊占那一格的两种状态：录音与收尾。收尾期间条冻住、整粒不可点。 */
  const pillVisible = recording || status === "finishing";
  const bars = useLevelBars(level, pillVisible);
  // 环只在那一格空着的时候画：胶囊（录音/收尾）、请求权限、安装中、安装失败都各自占着那一格。
  const showPolishRing =
    polishing === true &&
    !pillVisible &&
    !busy &&
    !installing &&
    !installFailed;
  // 下载中 / 整理中，麦克风在忙别的事，气泡与可访问名都报那个状态。
  const activeLabel = installing
    ? t("chat.voiceInstalling", { percent })
    : showPolishRing
      ? t("chat.voicePolishing")
      : null;
  // 气泡在空闲且麦克风可用时才多报一句快捷键。收尾 / 下载时那颗键按下去
  // 没反应（usePushToTalk 的 onStart 只认 idle），写了就是假的。
  const idleTooltip =
    micDisabled || !shortcutKeys
      ? t("chat.voiceStart")
      : t("chat.voiceStartWithShortcut", { keys: shortcutKeys });
  // 这一格只有一个按钮，它按时序变形：录音时是一粒胶囊（停止键），其余时候是麦克风。
  // 三样东西（可访问名 / 气泡 / 禁用）都按“它现在是什么”报，而不是各报各的。
  const ariaLabel = pillVisible
    ? t("chat.voiceStop")
    : (activeLabel ?? t("chat.voiceStart"));
  const tooltipLabel = pillVisible
    ? status === "finishing"
      ? // 收尾期间 Esc 不再取消（hook 的监听只认 recording / requesting），
        // 气泡不能许诺一个按下去没反应的键。
        t("chat.voiceStop")
      : t("chat.voiceStopWithEsc")
    : (activeLabel ?? idleTooltip);
  const buttonDisabled = pillVisible ? status === "finishing" : micDisabled;
  // 焦点不能丢：键盘用户用空格开始录音后，按钮一旦换成另一个元素，焦点就掉到 body，
  // 故事就停了（既没被告知录上了，也无法再按空格停下）。所以只换类名与内容。
  const buttonClassName = pillVisible
    ? "flex h-8 shrink-0 items-center gap-2 rounded-full bg-surface-hover px-2.5 transition-colors hover:bg-surface-active disabled:cursor-not-allowed"
    : "relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {!pillVisible && installing && (
        <>
          {/* 下载进度占的正是录音胶囊那一格（原地，不加浮层） */}
          <div
            className="h-1 w-10 overflow-hidden rounded-full bg-border-muted"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-text-muted">
            {percent}%
          </span>
        </>
      )}

      {!pillVisible && installFailed && (
        <span className="px-1 text-xs text-error">
          {t("chat.voiceInstallFailed")}
        </span>
      )}

      <Tooltip label={tooltipLabel}>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={buttonDisabled}
          onClick={onToggle}
          className={buttonClassName}
        >
          {pillVisible ? (
            <>
              {/* 波形条 `aria-hidden`：它的含义已经在按钮的可访问名（「停止录音」）里。
                  高度走 inline style —— 电平是运行时数据，Tailwind 不能穷举。 */}
              <span className="flex h-4 items-end gap-[2px]" aria-hidden>
                {LEVEL_SLOTS.map((slot) => (
                  <span
                    key={slot}
                    data-testid="voice-level-bar"
                    className="w-[3px] rounded-full bg-text-muted transition-[height] duration-150 ease-out"
                    style={{ height: `${bars[slot]}%` }}
                  />
                ))}
              </span>
              <span className="text-xs tabular-nums text-text-muted">
                {formatSeconds(seconds)}
              </span>
            </>
          ) : (
            <>
              {showPolishRing && (
                <span
                  aria-hidden
                  data-testid="voice-polish-ring"
                  className="pointer-events-none absolute -inset-[3px] rounded-[11px] border-2 border-accent opacity-[0.55] animate-voice-polish-ring"
                />
              )}
              {busy || installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * 把 `useVoiceInput` 的控制器适配成按钮的 props。
 *
 * 放在这里而不是两个宿主各写一份：ChatView 与 WelcomeView 都要这一层。
 * 控制器的方法返回 Promise，按钮只要 `() => void`，所以在这里丢掉返回值。
 */
export function toMicButtonProps(
  voice: VoiceInputController,
  // 不给默认值：宿主漏传时要是编译错误，而不是「底栏一直不显示进度」这种没人会发现的状态。
  install: VoiceInstallState | null,
  // 快捷键那一组打成一个对象：三个都是字符串/函数，位置传错了类型也拦不住。
  shortcut: {
    /** 引擎配置。缺省 = 还没读到配置，按「没启用」处理。 */
    config: VoiceEngineConfig | undefined;
    platform: string | undefined;
    t: TFunction;
  },
): VoiceMicButtonProps {
  // 与 usePushToTalk 的 enabled 同源：引擎没启用时快捷键不监听，气泡也就不提它。
  // `disabled` 由 holdKeyNameKey 自己吞掉，这里不用再判一次。
  const keyNameKey =
    shortcut.config?.enabled === true
      ? holdKeyNameKey(
          shortcut.config.shortcut,
          shortcutPlatform(shortcut.platform),
        )
      : undefined;

  return {
    status: voice.status,
    level: voice.level,
    seconds: voice.seconds,
    polishing: voice.polishing,
    install,
    shortcutKeys: keyNameKey ? shortcut.t(keyNameKey) : undefined,
    onToggle: voice.toggle,
  };
}
