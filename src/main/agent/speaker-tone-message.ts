/**
 * @module main/agent/speaker-tone-message
 *
 * 把这一轮说话人的情感送达模型：写一条**隐藏 custom 消息**（`display: false`），
 * 位置在本轮用户消息之前。
 *
 * 为什么不拼进 prompt、也不放系统提示词（spec §5）：
 * - 拼 prompt 会破坏 SDK 的 `/skill:` 识别与模板展开（与 element-context 同一条约束）。
 * - 放系统提示词尾部会让 system 块每轮变化，而 Anthropic 的 `cache_control` 打在该块末尾，
 *   整块连同后面的历史一起重算。
 *
 * 打断场景（agent 正在流式输出）**跳过而不是抛错**：语音模式有打断，
 * 抛错会弄坏一轮对话。与 `element-context-message.ts` 的行为刻意不同。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  EMOTION_CONFIDENCE_THRESHOLD,
  type EmotionLabel,
  type EmotionSignal,
} from "../../shared/voice-emotion";

/** 不注入的类别：中性没有信息量；其他与未知不是情绪。 */
const SILENT_LABELS = new Set<EmotionLabel>(["neutral", "other", "unknown"]);

const STRATEGY: Record<EmotionLabel, string> = {
  angry:
    "Answer plainly and briefly. Do the thing first, and do not open with an apology.",
  disgusted:
    "Answer plainly and briefly. Do the thing first, and do not open with an apology.",
  fearful:
    "Give certainty first: what can be done, and how long it takes. Do not offer a list of options.",
  happy: "You can be a little lighter here. Do not dampen the mood.",
  neutral: "",
  other: "",
  sad: "Answer gently and briefly. Do not rush into solutions.",
  surprised: "Lead with the answer, then the background.",
  unknown: "",
};

export function buildSpeakerToneText(emotion: EmotionSignal): string {
  if (emotion.confidence < EMOTION_CONFIDENCE_THRESHOLD) return "";
  if (SILENT_LABELS.has(emotion.label)) return "";
  const strategy = STRATEGY[emotion.label];
  if (!strategy) return "";
  const confidence = emotion.confidence.toFixed(2);
  return [
    `<speaker_tone label="${emotion.label}" confidence="${confidence}">`,
    `The speaker sounds ${emotion.label}. ${strategy}`,
    "Do not say you noticed their tone.",
    "</speaker_tone>",
  ].join("\n");
}

export async function appendSpeakerTone(
  session: Pick<AgentSession, "sendCustomMessage" | "isStreaming">,
  emotion: EmotionSignal | undefined,
): Promise<void> {
  if (!emotion) return;
  const text = buildSpeakerToneText(emotion);
  if (!text) return;
  if (session.isStreaming) {
    // 打断场景：SDK 会把消息推到本轮之后。宁可这一轮没有情感，也不排到用户消息后面。
    return;
  }
  await session.sendCustomMessage(
    { customType: "speaker_tone", content: text, display: false },
    { triggerTurn: false },
  );
}
