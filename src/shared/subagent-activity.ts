/**
 * 子代理实时活动的 IPC 载荷（main 组装、renderer 渲染）。
 *
 * `parentToolCallId` 由 DeskWand 自己填，等于触发这次 spawn 的 Agent 工具调用 id，
 * 也就是渲染层那张卡片的 block.id —— 与插件里那个永远为空的概念无关。
 */

export interface SubagentStep {
  id: string;
  toolName: string;
  args: Record<string, string>;
  done: boolean;
  isError?: boolean;
  durationMs?: number;
}

export interface SubagentActivityModel {
  name?: string;
  id?: string;
  thinking?: string;
}

export interface SubagentActivity {
  sessionId: string;
  agentId: string;
  parentToolCallId: string;
  /** 子代理的别名（插件的 handle 命名空间），用于卡片标题的趣味名。 */
  name?: string;
  /** 子代理类型（插件 record 的 `type`），状态栏面板行要用。 */
  type?: string;
  /** spawn 时的任务描述（插件 record 的 `description`）。 */
  description?: string;
  /** true = 后台并发型；未声明（undefined）时不当作后台。 */
  background?: boolean;
  status: "running" | "completed" | "error";
  current?: SubagentStep;
  steps: SubagentStep[];
  stats: {
    toolUses: number;
    turnCount?: number;
    maxTurns?: number;
    /** input + output + cacheRead + cacheWrite（全量，含缓存重读）；未知时省略。 */
    tokens?: number;
    durationMs: number;
  };
  model?: SubagentActivityModel;
}
