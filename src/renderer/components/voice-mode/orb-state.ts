/**
 * @module renderer/components/voice-mode/orb-state
 *
 * 会话状态 → 球的视觉状态 / 状态文案。全屏浮层与后台小球共用一份，
 * 免得两处各写一张表、以后改一处漏一处。
 */
import type { OrbState } from "./star-orb";
import type { ConversationState } from "../../hooks/useVoiceConversation";

export const ORB_STATE: Record<ConversationState, OrbState> = {
  calibrating: "calibrating",
  listening: "listening",
  capturing: "capturing",
  thinking: "thinking",
  speaking: "speaking",
  blocked: "blocked",
  // 静音不是「出错」也不是「在忙」：用最暗的一档，配麦克风图标表示是用户关的。
  muted: "calibrating",
  stopped: "listening",
};

export const CAPTION_KEY: Record<ConversationState, string> = {
  calibrating: "voiceMode.stateCalibrating",
  listening: "voiceMode.stateListening",
  capturing: "voiceMode.stateCapturing",
  thinking: "voiceMode.stateThinking",
  speaking: "voiceMode.stateSpeaking",
  blocked: "voiceMode.stateBlocked",
  muted: "voiceMode.stateMuted",
  stopped: "voiceMode.stateStopped",
};
