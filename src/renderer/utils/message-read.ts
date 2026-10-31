/**
 * 用户消息的「已读回执」判定。纯函数，不碰 store、不碰 DOM。
 *
 * 语义（A 方案）：环只属于最新一轮 —— 发出后是「未读」，这一轮出现模型第一个 token
 * （正文 / 思考 / 工具调用任一）即「已读」；再发下一条时环交给新的一轮。
 *
 * 两个约定，都由本文件表达：
 * - 历史轮次不出环：这里没有这条分支 —— 调用方只把结果交给**最新那条用户消息**
 *   （`ChatView` 按 id 命中），历史自然拿不到。
 * - 哪条算「最新」：最后一条用户消息说了算，即使它没带 turnId（那样的消息不出环，
 *   但绝不回退到上一条 —— 回退会把收据盖到历史气泡上）。
 *
 * 另有一个必然结果：同时发两条时，第一条不是「最新」→ 全程不出环，只有排队那条
 * 显示「排队中」。
 */
import type { ContentBlock, Message } from "../types";

export type ReadReceiptState = "read" | "unread";

/** 最后一条用户消息；没有则 null。带不带 turnId 都算 —— 见文件头。 */
export function findLatestUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user") return message;
  }
  return null;
}

export function resolveReadState(input: {
  turnId?: string;
  localStatus?: "queued" | "cancelled";
  blocks?: ContentBlock[] | null;
  /** 正在流式的那些残段属于哪一轮；与本轮不同就不采信。 */
  partialTurnId?: string | null;
  partialMessage?: string;
  partialThinking?: string;
  isAwaiting: boolean;
}): ReadReceiptState | null {
  if (!input.turnId) return null;
  // 排队中 / 已取消：气泡里已有状态行，不要再叠一个「未读」。
  if (input.localStatus === "queued" || input.localStatus === "cancelled") {
    return null;
  }
  // `partialByTurn` 会留着别的轮次的残段 —— 不是本轮的就不算「开过口」。
  const partialBelongsToTurn = input.partialTurnId === input.turnId;
  // 工具块也算「开过口」：纯工具轮整轮都不会有正文。
  const replied =
    Boolean(input.blocks?.length) ||
    (partialBelongsToTurn && Boolean(input.partialMessage)) ||
    (partialBelongsToTurn && Boolean(input.partialThinking));
  if (replied) return "read";
  // 出错、被中断、重开旧会话：既没回复也不在等 —— 不显示，免得留一个假「未读」。
  if (input.isAwaiting) return "unread";
  return null;
}
