/**
 * @module renderer/utils/voice/backchannel
 *
 * 「用户刚才那句是不是只是在附和？」
 *
 * 用途只有一个：打断朗读之后，判断这次打断要不要撤销（见
 * `useVoiceConversation.ts` 的判决分支）。说一声"嗯"不该让答案作废。
 * 扬声器泄漏也走这条路 —— 它同样识别不出真内容。
 *
 * 它是启发式，不是模型。LiveKit 用音频模型区分真打断与附和（adaptive
 * interruption），那个是云特供；开源的准确对应物没有。词表能覆盖中文对话里
 * 绝大多数附和，且完全可测。
 *
 * 判定对象是**本轮最终文本**（`done` 事件的 text），不是 partial ——
 * partial 不稳定，用它判决会把半个字当成结论。
 */

/** 单字与叠字附和。 */
const WORDS = new Set([
  "嗯",
  "哦",
  "呃",
  "对",
  "是",
  "好",
  "行",
  "啊",
  "嗯嗯",
  "哦哦",
  "对对",
  "好的",
  "是啊",
  "对的",
]);

/**
 * 长度上限。超过就不看词表了 —— "好的那你帮我改一下这里"以"好的"开头，
 * 但它是实打实的指令。用长度兜住这类误判，比扩充词表可靠。
 */
const MAX_CHARS = 6;

export function isBackchannel(text: string): boolean {
  // 去掉空白与标点：ASR 会带标点，用户也会带停顿。
  const trimmed = text.replace(/[\s，。！？、,.!?…~]+/g, "");
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_CHARS) return false;

  if (WORDS.has(trimmed)) return true;

  // 整句是同一个字重复（"嗯嗯嗯嗯" 这类没进词表的写法）。
  const chars = [...trimmed];
  return chars.every((c) => c === chars[0]) && WORDS.has(chars[0]);
}
