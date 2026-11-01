/**
 * 上下文占用的「详细分类」估算。
 *
 * 只有一条精确数字可用：最后一条 assistant 消息的 `totalPromptInput`
 * （= 系统提示词 + 工具定义 + 记忆/技能 + 本次历史，全部计入窗口）。
 * 系统侧的真实文本在 SDK 内部：渲染层看不到，只有主进程读得到
 * （`main/agent/prompt-parts.ts` 量一次、把三个 token 估算发过来）。所以分法是：
 *
 *   消息侧按块类型估算 → 总量减去消息侧 = 系统侧总量（差值，含估算误差）
 *   系统侧总量按「主进程实测的三块比例」分成 系统提示词 / 工具定义 / 技能
 *
 * 主进程没给比例时（旧会话、量失败）退回一行「系统提示词与工具」，与旧行为一致。
 * 任何和真实用量对不上的地方都在 UI 侧标 ≈，不把估算值冒充成精确值。
 */

import type { ContentBlock, Message } from "../types";
import type { PromptParts } from "../../shared/prompt-parts";
import { estimateTextTokens } from "../../shared/token-estimate";

export { estimateTextTokens };

export type ContextCategoryId =
  | "system"
  | "tools"
  | "skills"
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
  /**
   * 系统侧总量（系统提示词 + 工具定义 + 技能）。压缩后由上次实测的残差顶上；
   * 不知道就是 0 —— 调用方用它记住「系统侧到底多大」，压缩后残差算不出来时靠它。
   */
  systemTotal: number;
  /**
   * 系统侧是否真的按实测比例分成了三块。false 时那一行是整个残差，
   * 标签必须退回「系统提示词与工具」—— 不能把工具与技能冒充成系统提示词。
   */
  systemSplit: boolean;
}

/** 每张图片的粗估 token。分辨率未知，取常见截图中位数。 */
const IMAGE_TOKENS = 1000;

/** 分类的稳定展示顺序：token 相同的行按它排，避免每帧跳位。 */
const CATEGORY_ORDER: ContextCategoryId[] = [
  "system",
  "tools",
  "skills",
  "user",
  "assistant",
  "thinking",
  "toolCalls",
  "toolResults",
  "media",
];

/** 系统侧三块的固定顺序（也是渲染顺序，与体量无关）。 */
const SYSTEM_PART_IDS = ["system", "tools", "skills"] as const;

/** 三块权重（坏的 / 负的当 0）。全为 0 就等于没有比例，不能分。 */
function sanitizeWeights(parts: PromptParts | undefined): number[] {
  if (!parts) return [];
  return [parts.promptTokens, parts.toolTokens, parts.skillTokens].map(
    (weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0),
  );
}

/**
 * 把系统侧总量按实测比例分成 系统提示词 / 工具定义 / 技能。
 *
 * 比例来自主进程实测的文本长度，总量仍是残差（含估算误差），所以三行一起承担误差。
 * 最后一行吃掉舍入误差，保证三行之和正好等于 `total`（否则表里的行加起来不等于总量）。
 * 没比例 / 比例为 0 时退回单行 —— 与加分类之前的旧行为一致。
 */
function splitSystemSide(
  total: number,
  weights: readonly number[],
): Array<{ id: ContextCategoryId; tokens: number }> {
  const single: Array<{ id: ContextCategoryId; tokens: number }> = [
    { id: "system", tokens: total },
  ];
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return single;

  const rows: Array<{ id: ContextCategoryId; tokens: number }> = [];
  let remaining = total;
  SYSTEM_PART_IDS.forEach((id, index) => {
    const isLast = index === SYSTEM_PART_IDS.length - 1;
    const tokens = isLast
      ? remaining
      : Math.min(remaining, Math.round((weights[index] / weightSum) * total));
    if (tokens > 0) rows.push({ id, tokens });
    remaining -= tokens;
  });
  return rows.length > 0 ? rows : single;
}

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
 * @param systemParts 主进程实测的「系统提示词 / 工具定义 / 技能」三块量级，
 *   只用作权重：系统侧总量仍是残差，三块按比例分它。没传就退回单行。
 */
export function buildContextBreakdown(
  messages: Message[],
  totalTokens: number | null,
  contextWindow: number | undefined,
  systemTokensHint?: number,
  systemParts?: PromptParts,
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
      systemTotal: 0,
      systemSplit: false,
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
  // 残差 = 系统提示词 + 工具定义 + 技能（含估算误差）。压缩后历史被摘要，
  // 残差会变成负数，改用上一次「未折算」时测得的值。
  const hint =
    systemTokensHint && systemTokensHint > 0 && systemTokensHint < totalTokens
      ? Math.round(systemTokensHint)
      : 0;
  const systemTotal = scaled ? hint : Math.max(0, totalTokens - messageTokens);
  const systemWeights = sanitizeWeights(systemParts);
  const systemSplit =
    systemTotal > 0 &&
    systemWeights.reduce((sum, weight) => sum + weight, 0) > 0;

  if (scaled) {
    // 压缩后历史已被摘要：消息侧按比例折算到（总量 − 系统侧份额）里。
    // 只剩整体折算时，最后一行吃掉舍入误差，保证各行之和正好等于总量、且不为负。
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
    if (hint > 0) entries.push(...splitSystemSide(hint, systemWeights));
  } else if (systemTotal > 0) {
    entries.push(...splitSystemSide(systemTotal, systemWeights));
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
    systemTotal,
    systemSplit,
  };
}
