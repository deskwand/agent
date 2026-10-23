import { useAppStore } from "../store";
import type { ContentBlock, QueuedInput, Session } from "../types";

/**
 * 排队区自动出队的簿记。
 *
 * 这两份标记必须活在组件之外：出队器已经不属于任何一个视图
 * （见 components/InputQueueDrainer.tsx），而「用户点了停止」发生在 ChatView，
 * 两边要共享同一份抑制标记 —— 否则停止后队列会被静默继续执行。
 */

/** 已发出、还没看到 running 的会话：同一个 idle 窗口内不许连发两条。 */
const inFlightSessions = new Set<string>();
/**
 * 用户点过 Stop 的会话：在它重新开跑（离开 idle）之前，不再自动出队。
 *
 * 不能「看到一次 idle 就消费掉」：出队器是按 store 变更扫的，停止那一瞬
 * ChatView 还会写 clearActiveTurn 等状态，下一次扫描就会把队列继续下去 ——
 * 停止等于没停。所以抑制标记跟着会话状态走：running 时清掉。
 */
const stopSuppressedSessions = new Set<string>();

export type QueuedInputSender = (
  sessionId: string,
  content: ContentBlock[],
  providerProfileKey: Session["providerProfileKey"],
  model: string | undefined,
  elSelections: QueuedInput["elSelections"],
) => Promise<unknown>;

/**
 * 排队条目 → 发给 SDK 的 content blocks。
 * 顺序沿用原实现：图片、文件在前，文本在最后一条。
 */
function buildQueuedContentBlocks(item: QueuedInput): ContentBlock[] {
  const blocks: ContentBlock[] = [
    ...(item.images ?? []),
    ...(item.files ?? []),
  ];
  if (item.text) {
    blocks.push({ type: "text", text: item.text });
  }
  return blocks;
}

/** 用户主动停止：抑制该会话的自动出队，直到它重新开跑（离开 idle）。 */
export function suppressNextInputQueueDrain(sessionId: string): void {
  stopSuppressedSessions.add(sessionId);
}

/** 测试用：清空模块级簿记（生产代码不应调用）。 */
export function resetInputQueueDrainState(): void {
  inFlightSessions.clear();
  stopSuppressedSessions.clear();
}

/**
 * 出队并发送一条：标记 in-flight、移出队列，失败时复位 in-flight。
 *
 * 手动引导（idle 点「引导」）也走这里 —— 否则它绕过 in-flight 标记，
 * 出队器会以为没人发过，立刻把下一条也发出去（双回合）。
 */
export function sendQueuedInput(
  sessionId: string,
  item: QueuedInput,
  send: QueuedInputSender,
  session: Pick<Session, "providerProfileKey" | "model">,
): void {
  inFlightSessions.add(sessionId);
  useAppStore.getState().removeInput(sessionId, item.id);
  void send(
    sessionId,
    buildQueuedContentBlocks(item),
    session.providerProfileKey,
    session.model,
    item.elSelections,
  ).catch(() => {
    // 发送失败（会话删除/非法 model 等）：复位 in-flight guard，避免队列永久卡死
    inFlightSessions.delete(sessionId);
  });
}

/**
 * 扫一遍**所有**会话：状态 idle、队列非空 → 按 FIFO 发第一条。
 *
 * 与视图无关是重点：以前这段逻辑写在 ChatView 的 effect 里，于是「排队」
 * 只对当前打开的那个会话成立 —— 用户切到别的会话、或切到设置/应用等页面时
 * ChatView 卸载，排队项就停在那里，必须切回该会话才会继续跑。
 */
export function drainIdleInputQueues(send: QueuedInputSender): void {
  const state = useAppStore.getState();
  for (const session of state.sessions) {
    if (session.status !== "idle") {
      inFlightSessions.delete(session.id);
      stopSuppressedSessions.delete(session.id);
      continue;
    }
    const sessionState = state.sessionStates[session.id];
    if (!sessionState) continue;
    // 归档会话的队列不自动跑：用户已经把会话收起了，不该在后台冒出回合。
    if (session.archived) continue;
    // 压缩中禁止发送（与 ChatView handleSubmit 的守卫一致）
    if (sessionState.compaction?.status === "running") continue;
    if (inFlightSessions.has(session.id)) continue;
    if (stopSuppressedSessions.has(session.id)) continue;
    const item = (sessionState.inputQueue ?? [])[0];
    if (!item) continue;
    sendQueuedInput(session.id, item, send, session);
  }
}
