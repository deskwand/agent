import { Loader2, Mic, Square, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { VoiceInstallState } from "../../shared/ipc-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import type { VoiceInputController, VoiceStatus } from "../hooks/useVoiceInput";
import type { VoiceEngineConfig } from "../types";
import { holdKeyNameKey, shortcutPlatform } from "../voice-shortcut-labels";
import { Button } from "./app-button";

/**
 * 那一格的全部输入。**没有 level / seconds**：电平与计时由卡片内的
 * `VoiceRecordingStrip` 显示 —— 36px 的一格装不下波形，撑开就会把编辑区
 * 和相邻控件挤走。
 */
export interface VoiceMicButtonProps {
  status: VoiceStatus;
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
   * 另一处在录音（全局互斥）。
   *
   * true = 整粒禁用，气泡与可访问名改报「另一处正在录音」。可选：既有几个替身只填了
   * 录音那几项，不该为一个新状态去改它们；真正要守的是**接线**漏传 —— 那一条由
   * `toMicButtonProps` 的必传参数拦下。
   */
  blocked?: boolean;
  /**
   * 「按住说话」的键名（已 i18n，如「右 Option」）。缺省 = 本气泡不提快捷键：
   * 引擎没启用，或用户在设置里选了「不使用快捷键」。
   */
  shortcutKeys?: string;
  onToggle: () => void;
}

/**
 * 那一格的几何。**任何状态都不许改它** —— 它恒定占一格：在输入卡右簇里（展开与发送
 * 之间）一变宽就要把编辑器和发送键一起推走；在 AskUserVoiceField 里它是绝对定位在
 * 输入框右下角，变宽会盖住正在输入的文字。
 * 六种状态的差异只允许体现在图标与颜色上。
 */
const MIC_SLOT_CLASS =
  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

/** 安装进度环。轨道用 `text-muted-foreground` 的 20% 透明度，弧用 `text-primary-text`。 */
function InstallProgressRing({ percent }: { percent: number }) {
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg
      // 尺寸由按钮上的 `[&_svg]:size-7` 给：`.w-7` 是单类名（0,1,0），
      // 赢不过 Button base 的 `[&_svg]:size-4`（`.cls svg` = 0,1,1）。
      className="-rotate-90"
      viewBox="0 0 28 28"
      aria-hidden="true"
    >
      <circle
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="opacity-20"
      />
      <circle
        data-testid="voice-install-arc"
        cx="14"
        cy="14"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        className="text-primary-text"
      />
    </svg>
  );
}

export function VoiceMicButton({
  status,
  install,
  polishing,
  blocked,
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
  const micDisabled = busy || installing || blocked === true;
  const recording = status === "recording";
  /** 这一格现在报的是「停止」：录音中与收尾中。收尾期间按钮锁住但仍是同一颗。 */
  const stopping = recording || status === "finishing";
  // 环只在那一格空着的时候画：停止键（录音/收尾）、请求权限、安装中、安装失败都各自占着那一格。
  const showPolishRing =
    polishing === true && !stopping && !busy && !installing && !installFailed;
  // 下载中 / 装失败了 / 被别人占着 / 整理中，麦克风在忙别的事，气泡与可访问名都报那个状态。
  // 失败排最前：它才是「为什么这一格是红的」。点下去是重试（`micDisabled` 不含它）。
  // 「被别人占着」排在失败前面：按钮此刻是禁用的，先说清为什么点不动；
  // 失败本身还有红色图标在，不会丢。
  const activeLabel =
    blocked === true
      ? t("chat.voiceBusyElsewhere")
      : installFailed
        ? t("chat.voiceInstallFailedRetry")
        : installing
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
  // 这一格只有一个按钮，它按时序变形：录音时是一个停止方块，其余时候是麦克风。
  // 三样东西（可访问名 / 气泡 / 禁用）都按“它现在是什么”报，而不是各报各的。
  const ariaLabel = stopping
    ? t("chat.voiceStop")
    : (activeLabel ?? t("chat.voiceStart"));
  const tooltipLabel = stopping
    ? status === "finishing"
      ? // 收尾期间 Esc 不再取消（hook 的监听只认 recording / requesting），
        // 气泡不能许诺一个按下去没反应的键。
        t("chat.voiceStop")
      : t("chat.voiceStopWithEsc")
    : (activeLabel ?? idleTooltip);
  // 焦点不能丢：键盘用户用空格开始录音后，按钮一旦换成另一个元素，焦点就掉到 body，
  // 故事就停了（既没被告知录上了，也无法再按空格停下）。所以只换图标与颜色。
  // 计时与波形在卡片内的 VoiceRecordingStrip：36px 装不下它们，撑宽会抢编辑区。
  const buttonClassName = `${MIC_SLOT_CLASS} ${
    stopping || installFailed ? "text-destructive hover:text-destructive" : ""
  } ${installing ? "[&_svg]:size-7" : ""}`;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            aria-label={ariaLabel}
            disabled={micDisabled}
            onClick={onToggle}
            className={buttonClassName}
          >
            {stopping ? (
              <>
                {/* 整理环与录音环共用这一档呼吸动画：两者都是「这一刻这一格在忙」。 */}
                <span
                  aria-hidden
                  data-testid="voice-recording-ring"
                  className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-destructive opacity-[0.55] animate-voice-polish-ring"
                />
                <Square className="h-4 w-4" />
              </>
            ) : (
              <>
                {showPolishRing && (
                  <span
                    aria-hidden
                    data-testid="voice-polish-ring"
                    className="pointer-events-none absolute -inset-[3px] rounded-[11px] border-2 border-primary opacity-[0.55] animate-voice-polish-ring"
                  />
                )}
                {installing ? (
                  <InstallProgressRing percent={percent} />
                ) : installFailed ? (
                  <TriangleAlert className="h-4 w-4" />
                ) : busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </>
            )}
          </Button>
        </TooltipTrigger>
        {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
            而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
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
  // 同上不给默认值：漏传 = 这一格永远不进入互斥，没人会发现。
  blocked: boolean,
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
    polishing: voice.polishing,
    install,
    blocked,
    shortcutKeys: keyNameKey ? shortcut.t(keyNameKey) : undefined,
    onToggle: voice.toggle,
  };
}
