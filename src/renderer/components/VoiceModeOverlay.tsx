/**
 * @module renderer/components/VoiceModeOverlay
 *
 * 全屏浮层：球居中，胶囊在顶，字幕在球下，右上角关闭。
 * 浮层不拖历史、不做滚动 —— 那是文字界面的活（设计 §3.1）。
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { StarOrb, type OrbState } from "./voice-mode/star-orb";
import { VOICE_MESSAGE_KEYS } from "../hooks/useVoiceInput";
import { useVoiceMode } from "../hooks/useVoiceMode";
import type { ConversationState } from "../hooks/useVoiceConversation";

export interface VoiceModeOverlayProps {
  sessionId: string;
  onClose(): void;
  isCompacting: boolean;
  /** 把一轮问题发出去。由 ChatView 注入（它手上有 continueSession）。 */
  onSendQuestion(text: string): void;
}

const ORB_STATE: Record<ConversationState, OrbState> = {
  calibrating: "calibrating",
  listening: "listening",
  capturing: "capturing",
  thinking: "thinking",
  speaking: "speaking",
  blocked: "blocked",
  stopped: "listening",
};

const CAPTION_KEY: Record<ConversationState, string> = {
  calibrating: "voiceMode.stateCalibrating",
  listening: "voiceMode.stateListening",
  capturing: "voiceMode.stateCapturing",
  thinking: "voiceMode.stateThinking",
  speaking: "voiceMode.stateSpeaking",
  blocked: "voiceMode.stateBlocked",
  stopped: "voiceMode.stateStopped",
};

export function VoiceModeOverlay({
  sessionId,
  onClose,
  isCompacting,
  onSendQuestion,
}: VoiceModeOverlayProps): JSX.Element {
  const { t } = useTranslation();
  const view = useVoiceMode({
    sessionId,
    isCompacting,
    sendQuestion: onSendQuestion,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const caption = view.error
    ? t(VOICE_MESSAGE_KEYS[view.error])
    : t(CAPTION_KEY[view.state]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("voiceMode.exit")}
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-2xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="h-[min(620px,62vh)] w-[min(620px,86vw)]">
        <StarOrb state={ORB_STATE[view.state]} level={view.level} />
      </div>

      <p className="mt-2 text-sm text-text-secondary">{caption}</p>

      <div className="mt-6 min-h-[4rem] max-w-[46rem] px-8 text-center text-lg leading-relaxed text-text-primary">
        {view.state === "capturing" || view.state === "thinking"
          ? view.transcript
          : view.answer}
      </div>
    </div>
  );
}
