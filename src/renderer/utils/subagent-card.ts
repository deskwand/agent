// 子代理卡片的两个纯函数（无 React、无 store），便于单测。
import type {
  SubagentActivity,
  SubagentStep,
} from "../../shared/subagent-activity";
import { agentNameZhLabel } from "../../shared/agent-names";

/**
 * 把工具参数里的 agent 引用换成可读的显示名。
 *
 * ⚠️ 两套 id 不是一回事：`subagentActivities` 的 key 是 Agent 工具调用 id
 * （`parentToolCallId`），而参数里的 `agent_id` 对的是快照的 `agentId`（插件 record id）。
 * 所以必须遍历 values 比对，不能写 `activities[ref]`。
 */
export function resolveSubagentName(
  ref: string | undefined,
  activities: Record<string, SubagentActivity> | undefined,
  locale: string,
): string {
  const raw = String(ref ?? "").trim();
  const bare = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!bare) return "";

  const list = activities ? Object.values(activities) : [];
  // 命中 record id 就用它的别名；传的本来就是别名（或没命中）时原样沿用
  const alias = list.find((item) => item.agentId === bare)?.name ?? bare;

  const zhLabel = locale.startsWith("zh") ? agentNameZhLabel(alias) : undefined;
  return zhLabel ?? alias;
}

/**
 * 拆出插件输出的元信息头。
 *
 * 插件的 `get_subagent_result` 输出形如 `Agent: <id>\nType: …\nDescription: …\n\n<正文>`；
 * 而 MessageMarkdown 没开 `breaks`，单换行会被并成一段，所以头部要单独渲染。
 * 规则保守：**只有以 `Agent: ` 开头且含空行时才拆**，其余（`Sent to @hopper`、
 * `Agent failed: …`）整块当正文。
 */
export function splitSubagentOutput(content: string): {
  header?: string;
  body: string;
} {
  if (!content.startsWith("Agent: ")) return { body: content };
  const blank = content.match(/\n[ \t]*\n/);
  if (!blank || blank.index === undefined) return { body: content };
  return {
    header: content.slice(0, blank.index).trimEnd(),
    body: content.slice(blank.index + blank[0].length).trimStart(),
  };
}

/** 状态栏面板的一行。 */
export interface BackgroundAgentRow {
  toolCallId: string;
  name?: string;
  type?: string;
  description?: string;
  status: "running" | "completed" | "error";
  currentLabel?: string;
  stepCount: number;
  durationMs: number;
}

/**
 * 把会话的活动快照整理成面板行。
 * 只收 `background === true`（前台阻塞型卡片就在眼前，不需要入口）；
 * 运行中排前面，组内保持传入顺序——对象键序就是「最近更新」序（store 写入时先删后插）。
 */
export function buildBackgroundAgentRows(
  activities: Record<string, SubagentActivity> | undefined,
  labelFor: (step: SubagentStep) => string,
  locale: string,
): BackgroundAgentRow[] {
  const rows = Object.entries(activities ?? {})
    .filter(([, activity]) => activity.background === true)
    // 键序 = 最近更新序（store 写入时先删后插 → 最后写入的在末尾）。面板贴底向上长、
    // 首行在最上方，所以反转一下，让刚触发的那个排在最显眼处。
    .reverse()
    .map(([toolCallId, activity]) => {
      const lastStep =
        activity.current ?? activity.steps[activity.steps.length - 1];
      const alias = activity.name;
      const zhLabel =
        alias && locale.startsWith("zh") ? agentNameZhLabel(alias) : undefined;
      return {
        toolCallId,
        name: zhLabel ?? alias,
        type: activity.type,
        description: activity.description,
        status: activity.status,
        currentLabel: lastStep ? labelFor(lastStep) : undefined,
        stepCount: activity.stats.toolUses,
        durationMs: activity.stats.durationMs,
      };
    });

  return [
    ...rows.filter((row) => row.status === "running"),
    ...rows.filter((row) => row.status !== "running"),
  ];
}

/** 跳转需要的最小消息结构：ChatView 的 `displayedMessages` 结构性满足它。 */
export interface JumpMessageLike {
  id: string;
  role: string;
  turnId?: string;
  content: unknown;
}

/**
 * 找 toolCallId 所属回合的「回合末消息」id —— Agent 卡所在的 process summary 就挂在它上面。
 *
 * 为什么吃整个 `displayedMessages` 而不是渲染窗口里的 entries：目标常常在窗口外
 * （用户「往上找」碰到的正是这种），而 `handleDockTickSelect` 自己会把窗口滑过去——
 * 但那要求我们先交出 messageId，所以映射必须在窗口外也能命中。
 */
export function findTurnEndMessageIdForToolCall(
  messages: ReadonlyArray<JumpMessageLike> | undefined,
  toolCallId: string,
): string | null {
  const list = messages ?? [];
  if (!toolCallId) return null;

  const index = list.findIndex(
    (message) =>
      Array.isArray(message.content) &&
      (message.content as Array<{ type?: string; id?: string }>).some(
        (block) => block?.type === "tool_use" && block.id === toolCallId,
      ),
  );
  if (index === -1) return null;

  const start = list[index];
  const blocksOf = (message: JumpMessageLike) =>
    Array.isArray(message.content)
      ? (message.content as Array<{ type?: string }>)
      : [];
  /** 纯工具消息（没有 text 块）——渲染前会被并进同回合的前一条 assistant 消息。 */
  const isPureToolMessage = (message: JumpMessageLike) => {
    const blocks = blocksOf(message);
    return (
      message.role === "assistant" &&
      blocks.length > 0 &&
      !blocks.some((block) => block?.type === "text")
    );
  };

  // 回合范围：有 turnId 就比 turnId，没有就退化到「前后遇到 user 消息为止」。
  const sameTurn = (message: JumpMessageLike) =>
    start.turnId !== undefined
      ? message.turnId === start.turnId
      : message.role !== "user";
  let rangeStart = index;
  while (rangeStart > 0 && sameTurn(list[rangeStart - 1])) rangeStart--;
  let rangeEnd = index;
  while (rangeEnd + 1 < list.length && sameTurn(list[rangeEnd + 1])) rangeEnd++;

  // 目标必须是**在 DOM 里留下自己节点**的那条消息（`data-message-id` 由合并后的消息产出）。
  // 规则复刻自 ChatView.tsx:700-746 的合并循环：纯工具消息若在同回合内**前面**已有 assistant，
  // 就被并走、自己不再渲染（注意合并是向前回溯找同回合 assistant 的，所以这里要从回合头走）。
  let lastNodeId: string | null = null;
  let seenAssistant = false;
  for (let i = rangeStart; i <= rangeEnd; i++) {
    const message = list[i];
    if (message.role !== "assistant") continue;
    const mergedAway = isPureToolMessage(message) && seenAssistant;
    if (!mergedAway) lastNodeId = message.id;
    seenAssistant = true;
  }
  return lastNodeId;
}
