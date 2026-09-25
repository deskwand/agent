// 子代理卡片的两个纯函数（无 React、无 store），便于单测。
import type { SubagentActivity } from "../../shared/subagent-activity";
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
