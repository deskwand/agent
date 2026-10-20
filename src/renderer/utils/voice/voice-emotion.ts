import type { VoiceEvent } from "../../../shared/ipc-types";
import {
  isEmotionSignal,
  type EmotionSignal,
} from "../../../shared/voice-emotion";

/** 从 `done` 事件取情感。不信 IPC 载荷，一律过守卫。 */
export function emotionFromDone(event: VoiceEvent): EmotionSignal | undefined {
  if (event.type !== "done") return undefined;
  return isEmotionSignal(event.emotion) ? event.emotion : undefined;
}
