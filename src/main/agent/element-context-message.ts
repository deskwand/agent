/**
 * @module main/agent/element-context-message
 *
 * 本模块干**两件事**，两者职责不同，别混：
 *
 * 1. `collectSyntheticContextText`：**解码宿主传输**。用户消息的 text content block
 *    不会自动进模型请求（只有 image 块会被 `collectPromptImagesFromBlocks` 挂到
 *    prompt 上），宿主把元素上下文放在一个 `synthetic: true` 的 text block 里当作
 *    渲染层→runner 的搬运载体，这里把它取出来。
 * 2. `appendElementContext`：**送达与持久化**。通过 SDK 的 `sendCustomMessage`
 *    写一条隐藏 custom message，它同时进入模型上下文与 JSONL —— 这才是真正的
 *    送达环节。
 *
 * 为什么不用 prompt 拼接：宿主 `saveMessage` 只维护内存 cache
 * （`session-manager.ts:2247`），content 通道**不提供任何持久化**；而拼进
 * prompt / finalPrompt 会破坏 SDK 的 `/skill:` 识别与模板展开。
 * `synthetic` 标记的唯一作用就是让宿主**实时 UI**过滤掉那个搬运块，
 * 它既不参与送达也不参与持久化。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ElementSelectionRef } from "../../shared/ipc-types";

export function collectSyntheticContextText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; synthetic?: boolean };
    if (b.type !== "text" || b.synthetic !== true) continue;
    if (typeof b.text !== "string") continue;
    const trimmed = b.text.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join("\n\n");
}

export async function appendElementContext(
  session: Pick<AgentSession, "sendCustomMessage" | "isStreaming">,
  text: string,
  selections?: ElementSelectionRef[],
): Promise<void> {
  if (!text.trim()) return;
  // 元素附件只走 SessionManager 串行回合队列，不走 live steer。
  if (session.isStreaming) {
    throw new Error("Element context requires an idle SDK session");
  }
  await session.sendCustomMessage(
    {
      customType: "browser_element_selection",
      content: text,
      display: false,
      // details 落 JSONL 但不进模型：气泡回显重放时的唯一来源。
      // 没有引用时不要写这个键（省掉 JSONL 里的 `"details":undefined` 噪音）。
      ...(selections?.length ? { details: { selections } } : {}),
    },
    { triggerTurn: false },
  );
}
