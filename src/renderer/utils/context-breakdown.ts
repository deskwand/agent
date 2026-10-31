/**
 * 上下文占用的「详细分类」估算。
 *
 * 只有一条精确数字可用：最后一条 assistant 消息的 `totalPromptInput`
 * （= 系统提示词 + 工具定义 + 记忆/技能 + 本次历史，全部计入窗口）。
 * 系统提示词与工具定义在 SDK 内部，未暴露 token 数，所以分法固定为：
 *
 *   消息侧按块类型估算 → 总量减去消息侧 = 「系统提示词与工具」（差值，含估算误差）
 *
 * 任何和真实用量对不上的地方都在 UI 侧标 ≈，不把估算值冒充成精确值。
 */

import type { ContentBlock, Message } from "../types";

/** CJK 区段：部首/统一表意、韩文音节、兼容表意、全角标点。 */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function isCjk(code: number): boolean {
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to);
}

/**
 * 粗估文本 token：CJK 约 1 token/字，ASCII 约 4 字符/token，其余 1 token/字符。
 * 只用于分类占比；百分比主数字仍用 provider 回报的精确值。
 *
 * 刻意逐 UTF-16 单元遍历而不是 `[...text]`：上下文动辄百万字符，
 * 展开成单字符数组本身就比估算更贵。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      ascii += 1;
      continue;
    }
    const code = text.codePointAt(i) ?? unit;
    if (code > 0xffff) i += 1; // 代理对：跳过低位，整对算 1 个字符
    if (isCjk(code)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + ascii / 4 + other);
}

export type ContextCategoryId =
  | "system"
  | "user"
  | "assistant"
  | "thinking"
  | "toolCalls"
  | "toolResults"
  | "media";

export interface ContextBreakdownRow {
  id: ContextCategoryId;
  tokens: number;
  /** 占窗口 0–100；窗口未知时为 0，须由 windowTokens 判断该值无效。 */
  percent: number;
}

export interface ContextBreakdown {
  /** 已占用分类，按 tokens 降序；不含空闲。无历史/无用量时为空数组。 */
  rows: ContextBreakdownRow[];
  /** 窗口未知时为 null。 */
  freeTokens: number | null;
  freePercent: number;
  /** null = 窗口未知，UI 的百分比列显示 "--"。 */
  windowTokens: number | null;
  /** 压缩后历史被摘要（消息估算 > 总量）时为 true。 */
  scaled: boolean;
}

/** 每张图片的粗估 token。分辨率未知，取常见截图中位数。 */
const IMAGE_TOKENS = 1000;

/** 分类的稳定展示顺序：token 相同的行按它排，避免每帧跳位。 */
const CATEGORY_ORDER: ContextCategoryId[] = [
  "system",
  "user",
  "assistant",
  "thinking",
  "toolCalls",
  "toolResults",
  "media",
];

function blockTokens(block: ContentBlock): number {
  switch (block.type) {
    case "text":
      return estimateTextTokens(block.text);
    case "thinking":
      return estimateTextTokens(block.thinking);
    case "tool_use":
      return estimateTextTokens(block.name + JSON.stringify(block.input ?? {}));
    case "tool_result":
      return (
        estimateTextTokens(block.content) +
        (block.images?.length ?? 0) * IMAGE_TOKENS
      );
    case "image":
      return IMAGE_TOKENS;
    case "file_attachment":
      // 附件内容不进提示词，模型看到的是文件名/路径（读内容得走工具）。
      return estimateTextTokens(block.filename + block.relativePath);
    default:
      return 0;
  }
}

/** 必须先按块类型分流：tool_result 消息的 role 同样是 assistant。 */
function categoryOf(
  message: Message,
  block: ContentBlock,
): ContextCategoryId | null {
  if (block.type === "image" || block.type === "file_attachment")
    return "media";
  if (block.type === "tool_result") return "toolResults";
  if (block.type === "thinking") return "thinking";
  if (block.type === "tool_use") return "toolCalls";
  if (block.type !== "text") return null;
  return message.role === "user" ? "user" : "assistant";
}

const messageCategoryCache = new WeakMap<
  Message,
  Map<ContextCategoryId, number>
>();

/**
 * 单条消息的分类 token。按**消息对象身份**缓存：流式输出时 store 只替换
 * 受影响的那一条（其余保持引用），所以每帧只需重算一条，不必重扫全量历史。
 */
export function categorizeMessage(
  message: Message,
): Map<ContextCategoryId, number> {
  const cached = messageCategoryCache.get(message);
  if (cached) return cached;
  const sums = new Map<ContextCategoryId, number>();
  for (const block of message.content) {
    const id = categoryOf(message, block);
    if (!id) continue;
    const tokens = blockTokens(block);
    if (tokens > 0) sums.set(id, (sums.get(id) ?? 0) + tokens);
  }
  messageCategoryCache.set(message, sums);
  return sums;
}

/**
 * 构建分类明细。
 *
 * @param messages 当前会话的历史（渲染层全量；压缩后可能比真实上下文长）
 * @param totalTokens 精确总量（`totalPromptInput`，或压缩后的估算）
 * @param contextWindow 上下文窗口
 * @param systemTokensHint 上一次「未折算」时测得的系统侧残差。压缩后历史被摘要，
 *   消息估算会远超真实总量，残差算不出来；没有它，占比折算会把最大的真实分类
 *   （系统提示词与工具）整个吞掉。
 */
export function buildContextBreakdown(
  messages: Message[],
  totalTokens: number | null,
  contextWindow: number | undefined,
  systemTokensHint?: number,
): ContextBreakdown {
  const window = contextWindow && contextWindow > 0 ? contextWindow : null;
  // 无用量 / 历史未水合（messages 为空）：不猜分类，UI 保持原样。
  if (!totalTokens || totalTokens <= 0 || messages.length === 0) {
    return {
      rows: [],
      freeTokens: null,
      freePercent: 0,
      windowTokens: window,
      scaled: false,
    };
  }

  const merged = new Map<ContextCategoryId, number>();
  for (const message of messages) {
    for (const [id, tokens] of categorizeMessage(message)) {
      merged.set(id, (merged.get(id) ?? 0) + tokens);
    }
  }

  const messageTokens = [...merged.values()].reduce((a, b) => a + b, 0);
  const entries = [...merged].map(([id, tokens]) => ({ id, tokens }));
  const scaled = messageTokens > totalTokens;

  if (scaled) {
    // 压缩后历史已被摘要：消息侧按比例折算到（总量 − 系统侧份额）里。
    // 系统侧用上一次测得的残差，没有就整体折算；最后一行吃掉舍入误差，
    // 保证各行之和正好等于总量、且不为负。
    const hint =
      systemTokensHint && systemTokensHint > 0 && systemTokensHint < totalTokens
        ? Math.round(systemTokensHint)
        : 0;
    const budget = totalTokens - hint;
    const scale = budget / messageTokens;
    let remaining = budget;
    entries.sort((a, b) => b.tokens - a.tokens);
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      entry.tokens = isLast
        ? remaining
        : Math.min(remaining, Math.round(entry.tokens * scale));
      remaining -= entry.tokens;
    });
    if (hint > 0) entries.push({ id: "system", tokens: hint });
  } else {
    // 残差 = 系统提示词 + 工具定义 + 记忆/技能（含估算误差）。
    const residual = totalTokens - messageTokens;
    if (residual > 0) entries.push({ id: "system", tokens: residual });
  }

  entries.sort(
    (a, b) =>
      b.tokens - a.tokens ||
      CATEGORY_ORDER.indexOf(a.id) - CATEGORY_ORDER.indexOf(b.id),
  );

  const percentOf = (tokens: number) =>
    window ? Math.min((tokens / window) * 100, 100) : 0;
  const freeTokens = window ? Math.max(0, window - totalTokens) : null;

  return {
    rows: entries
      .filter((entry) => entry.tokens > 0)
      .map((entry) => ({
        id: entry.id,
        tokens: entry.tokens,
        percent: percentOf(entry.tokens),
      })),
    freeTokens,
    freePercent: freeTokens === null ? 0 : percentOf(freeTokens),
    windowTokens: window,
    scaled,
  };
}
