import { Loader2, Mic, X } from "lucide-react";
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
   * 「按住说话」的键名（已 i18n，如「右 Option」）。缺省 = 本气泡不提快捷键：
   * 引擎没启用，或用户在设置里选了「不使用快捷键」。
   */
  shortcutKeys?: string;
  onToggle: () => void;
  onCancel: () => void;
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceMicButton({
  status,
  level,
  seconds,
  install,
  shortcutKeys,
  onToggle,
  onCancel,
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
  // 下载中 / 录音中麦克风在忙别的事，气泡与可访问名都报那个状态。
  const activeLabel = installing
    ? t("chat.voiceInstalling", { percent })
    : recording
      ? t("chat.voiceStop")
      : null;
  // 可访问名只说动作：屏幕阅读器念一串按键是噪音。
  const ariaLabel = activeLabel ?? t("chat.voiceStart");
  // 气泡在空闲且麦克风可用时才多报一句快捷键。收尾 / 下载时那颗键按下去
  // 没反应（usePushToTalk 的 onStart 只认 idle），写了就是假的。
  const idleTooltip =
    micDisabled || !shortcutKeys
      ? t("chat.voiceStart")
      : t("chat.voiceStartWithShortcut", { keys: shortcutKeys });
  const tooltipLabel = activeLabel ?? idleTooltip;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {recording && (
        <>
          {/* 音量条：让用户知道麦克风在工作（对齐微信） */}
          <div className="flex h-4 w-10 items-end gap-[2px]" aria-hidden>
            {[0.15, 0.3, 0.45, 0.6].map((threshold) => (
              <span
                key={threshold}
                className={`w-[3px] rounded-full transition-all ${
                  level >= threshold ? "bg-error" : "bg-border-muted"
                }`}
                style={{ height: `${Math.max(20, threshold * 100)}%` }}
              />
            ))}
          </div>
          <span className="text-xs tabular-nums text-error">
            {formatSeconds(seconds)}
          </span>
        </>
      )}

      {!recording && installing && (
        <>
          {/* 下载进度占的正是录音电平条、计时器那一格（原地，不加浮层） */}
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

      {!recording && installFailed && (
        <span className="px-1 text-xs text-error">
          {t("chat.voiceInstallFailed")}
        </span>
      )}

      <Tooltip label={tooltipLabel}>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={micDisabled}
          onClick={onToggle}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            recording
              ? "bg-error/10 text-error"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          }`}
        >
          {busy || installing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className={`h-4 w-4 ${recording ? "animate-pulse" : ""}`} />
          )}
        </button>
      </Tooltip>

      {recording && (
        <Tooltip label={t("chat.voiceCancel")}>
          <button
            type="button"
            aria-label={t("chat.voiceCancel")}
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
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
    install,
    shortcutKeys: keyNameKey ? shortcut.t(keyNameKey) : undefined,
    onToggle: voice.toggle,
    onCancel: () => void voice.cancel(),
  };
}
