import type { ContextCategoryId } from "../../utils/context-breakdown";

export type SwatchId = ContextCategoryId | "free";

/**
 * 分类色用**同一支主色的透明度梯度**。
 *
 * 三条约束：
 * - 只用语义 token，不写死色值；
 * - 不借 success/warning/destructive 这类状态色 —— 图表里的绿色/黄色会被读成
 *   「出问题了」，而上下文占用是信息，不是告警；
 * - 相邻挡位至少差 10 个百分点：默认 zinc 主题的主色是中性灰，单 hue 梯度是唯一
 *   在深浅两套主题下都能保持亮度差的方案（实测见 context-section.test.tsx 的
 *   调色板断言与计划里的手工深浅色核对）。
 *
 * 顺序 = 「越固定越深」：系统提示词/工具/技能是每轮都在的常量，消息侧由近到远变浅。
 */
export const SEGMENT_CLASS: Record<ContextCategoryId, string> = {
  system: "bg-primary",
  tools: "bg-primary/90",
  skills: "bg-primary/80",
  user: "bg-primary/70",
  assistant: "bg-primary/60",
  thinking: "bg-primary/45",
  toolCalls: "bg-primary/30",
  toolResults: "bg-primary/20",
  media: "bg-primary/10",
};

/** 「空闲」只有图例圆点、没有分段（剩下的轨道本身就是空的），用空心圈区分。 */
export const DOT_CLASS: Record<SwatchId, string> = {
  ...SEGMENT_CLASS,
  free: "border border-muted-foreground/60",
};

export const LABEL_KEY: Record<SwatchId, string> = {
  system: "overview.context.breakdownSystem",
  tools: "overview.context.breakdownTools",
  skills: "overview.context.breakdownSkills",
  user: "overview.context.breakdownUser",
  assistant: "overview.context.breakdownAssistant",
  thinking: "overview.context.breakdownThinking",
  toolCalls: "overview.context.breakdownToolCalls",
  toolResults: "overview.context.breakdownToolResults",
  media: "overview.context.breakdownMedia",
  free: "overview.context.breakdownFree",
};

/**
 * 系统侧还没拆开时（旧会话、主进程没量到）只有一行，标签必须退回合并版 ——
 * 否则「系统提示词 ≈108.6k」会把工具与技能冒充成系统提示词。
 */
export const MERGED_SYSTEM_LABEL_KEY = "overview.context.breakdownSystemTools";

/** 供 key 覆盖率测试遍历：`t(LABEL_KEY[...])` 是动态调用，i18n 静态守卫看不见。 */
export const CONTEXT_BREAKDOWN_LABEL_KEYS: readonly string[] = [
  ...Object.values(LABEL_KEY),
  MERGED_SYSTEM_LABEL_KEY,
];
