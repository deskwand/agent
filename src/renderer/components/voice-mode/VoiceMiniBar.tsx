/**
 * @module renderer/components/voice-mode/VoiceMiniBar
 *
 * 后台语音的悬浮控件：右下角一颗小球 + 一行字幕 + 静音 + 结束。
 *
 * 球就是全屏那颗星球的 "mini" 档（同一个组件、同一套状态参数），不是另画一个
 * 圆点 —— 两个视图必须是同一个会话的两种呈现，状态语言才不会两边改跑偏。
 */
import { useTranslation } from "react-i18next";
import { Mic, MicOff, X } from "lucide-react";
import { StarOrb } from "./star-orb";
import { CAPTION_KEY, ORB_STATE } from "./orb-state";
import { stripVoiceMarkers } from "../../utils/voice/voice-caption";
import { VOICE_MESSAGE_KEYS } from "../../hooks/useVoiceInput";
import { useSandboxSyncStatus } from "../../store/selectors";
import type { VoiceModeView } from "../../hooks/useVoiceMode";

export interface VoiceMiniBarProps {
  view: VoiceModeView;
  muted: boolean;
  onExpand(): void;
  onToggleMute(): void;
  onEnd(): void;
}

/**
 * 一行字幕取什么字：识别中的话优先，其次本轮回答。
 *
 * 「还没有回答」不只是 thinking 期间：整轮无可朗读文本时状态机会直接回
 * listening，只认状态的话那段回答一次都上不了屏。
 */
export function miniBarText(view: VoiceModeView): string {
  const showAnswer = view.state !== "capturing" && view.answer.length > 0;
  return showAnswer ? stripVoiceMarkers(view.answer) : view.transcript;
}

export function VoiceMiniBar({
  view,
  muted,
  onExpand,
  onToggleMute,
  onEnd,
}: VoiceMiniBarProps): JSX.Element {
  const { t } = useTranslation();
  // 右下角已经有沙箱同步 Toast 时向上让位，别互相盖住。
  const lifted = useSandboxSyncStatus() !== null;
  const caption = view.error
    ? t(VOICE_MESSAGE_KEYS[view.error])
    : miniBarText(view);

  return (
    <div
      data-testid="voice-mini-bar"
      className={`fixed right-4 z-40 ${lifted ? "bottom-20" : "bottom-4"}`}
    >
      <div className="flex max-w-[22rem] items-center gap-2 rounded-full border border-border-subtle bg-background/95 px-2 py-1.5 shadow-elevated backdrop-blur">
        <button
          type="button"
          data-testid="voice-mini-orb"
          aria-label={t("voiceMode.expand")}
          onClick={onExpand}
          className="h-10 w-10 shrink-0 rounded-full transition-transform hover:scale-105"
        >
          <StarOrb
            variant="mini"
            state={ORB_STATE[view.state]}
            level={view.level}
          />
        </button>
        <p
          data-testid="voice-mini-caption"
          className="min-w-0 flex-1 truncate text-xs text-text-secondary"
        >
          {caption || t(CAPTION_KEY[view.state])}
        </p>
        <button
          type="button"
          data-testid="voice-mini-mute"
          aria-label={muted ? t("voiceMode.unmuteMic") : t("voiceMode.muteMic")}
          onClick={onToggleMute}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {muted ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          data-testid="voice-mini-end"
          aria-label={t("voiceMode.endVoice")}
          onClick={onEnd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-error"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
