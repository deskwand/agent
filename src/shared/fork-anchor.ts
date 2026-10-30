/**
 * 分叉点锚点。
 *
 * 渲染层看到的助手消息 id 有两个来源：JSONL entry id（历史水合而来）与主进程
 * 流式发出的 uuidv4（见 agent-runner 的 `sendMessage`）。主进程的 messageCache
 * 一旦被重建（以 entries 重读）或清理（会话停止 / 缓存淘汰），实时 uuidv4 就
 * 再也查不到任何东西 —— 而那条消息在 JSONL 里还在，只是 id 换成了 entry id。
 * 此时 `session.fork` 只凭 id 找分叉点，就会误报「分叉点消息不存在」。
 *
 * 锚点给两边一个不随 id 变化的共同身份：消息里第一个「稳定内容块」。
 *   - text        → 内容 + 长度（截断到 MAX_ANCHOR_TEXT，避免 IPC 传整段正文）
 *   - tool_use    → provider 给的 tool call id（与 JSONL 一致）
 *   - tool_result → toolUseId（与 JSONL 一致）
 * thinking 不参与：渲染层渲染前会把思考块剥掉，JSONL 一侧保留 —— 拿它做锚点
 * 两边永远对不上。
 */

const MAX_ANCHOR_TEXT = 400;

/**
 * 沙盒会话里，助手正文送到渲染层之前会把真实沙盒路径改写成 `/workspace/...`
 * （agent-runner 的 sanitizeOutputPaths），JSONL 里保留的是真实路径。两边算锚点
 * 时把路径样式的片段折叠成同一个占位符，否则这类会话永远匹配不上。
 */
const PATH_LIKE = /\/[\w.\-@+%]+(?:\/[\w.\-@+%]+)*/g;

/**
 * 锚点匹配的接受上限：超过这个时间差就当作没匹配上。
 * 实时消息与它自己的 entry 只差一次落盘/流式耗时，而「同一段开场白出现在别的
 * 回合」会差得远 —— 宁可报错，也不要静默分叉到别的消息上。
 */
export const FORK_ANCHOR_MAX_DELTA_MS = 10 * 60_000;

function normalizeAnchorText(text: string): string {
  return text.replace(PATH_LIKE, "\u2039path\u203a");
}

function anchorOfBlock(block: unknown): string | null {
  if (!block || typeof block !== "object") return null;
  const b = block as {
    type?: unknown;
    text?: unknown;
    id?: unknown;
    toolUseId?: unknown;
  };
  if (b.type === "thinking") return null;
  if (b.type === "text" && typeof b.text === "string") {
    const text = normalizeAnchorText(b.text.trim());
    if (!text) return null;
    return `text:${text.length}:${text.slice(0, MAX_ANCHOR_TEXT)}`;
  }
  if (b.type === "tool_use" && typeof b.id === "string" && b.id) {
    return `tool_use:${b.id}`;
  }
  if (
    b.type === "tool_result" &&
    typeof b.toolUseId === "string" &&
    b.toolUseId
  ) {
    return `tool_result:${b.toolUseId}`;
  }
  return null;
}

/** 取消息第一个稳定内容块作为锚点；没有稳定块（纯图片等）返回 null。 */
export function buildForkAnchor(
  message: { content?: unknown } | null | undefined,
): string | null {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    const anchor = anchorOfBlock(block);
    if (anchor) return anchor;
  }
  return null;
}

/**
 * 按锚点在消息列表里定位分叉点；找不到（或只找到太远的）返回 -1。
 *
 * 同一段开场白出现不止一次时（“好的。”这种短回复），给出 `at`（渲染层那条
 * 消息的时间戳）就按时间最接近的取，并拒绝超过 FORK_ANCHOR_MAX_DELTA_MS 的
 * 候选；没有可用时间戳时退回最后一条 —— 重复文本里用户点的通常是最近那张卡。
 */
export function findForkAnchorIndex(
  messages: readonly { content?: unknown; timestamp?: unknown }[],
  anchor: string | null | undefined,
  at?: number | null,
): number {
  if (!anchor) return -1;
  const hasAt = typeof at === "number" && Number.isFinite(at);
  let last = -1;
  let best = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (buildForkAnchor(messages[i]) !== anchor) continue;
    if (last < 0) last = i;
    if (!hasAt) continue;
    const ts = messages[i].timestamp;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    const delta = Math.abs(ts - (at as number));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  if (last < 0) return -1;
  if (!hasAt || best < 0) return last;
  return bestDelta <= FORK_ANCHOR_MAX_DELTA_MS ? best : -1;
}
