/**
 * 连接页的域模型。
 *
 * 这是主进程与渲染进程共用的**唯一**类型来源 —— 不要在 ipc-types.ts 里重复定义。
 *
 * 设计要点（见 design-docs/2026-09-30-connectors-page-design.md §4）：
 *  - 卡片 = 模板级条目（`ConnectorEntry`），内含 0..N 个实例。空数组就是「还没添加」的引导卡片。
 *  - 状态是**动态的**，所以不做分组；靠状态徽标区分（D12）。
 *  - 没有 `capability` 字段：`tab` 已经决定卡片画什么控件，多一个字段就是同一事实存两份。
 */

export type ConnectorSourceId = "mcp-remote" | "mcp-builtin";

/** 决定分组，也决定卡片画什么控件。 */
export type ConnectorTab = "connect" | "capability";

export type ConnectorStatus =
  | { kind: "ready" }
  /** 已配置，但运行时没有任何状态 —— 也就是「没在连、也没连上」。
   *  不能拿它冒充 `connecting`：那会让卡片永远显示「进行中」且无处可退。 */
  | { kind: "idle" }
  | { kind: "connecting" }
  /** 已配置但 enabled:false */
  | { kind: "off" }
  /** 需要用户在浏览器完成授权 */
  | { kind: "needs-auth"; hint?: string }
  | { kind: "failed"; message: string };

export interface ConnectorInstance {
  /** 回传给主进程的原生 id（mcp.json 里的 server name） */
  id: string;
  label: string;
  status: ConnectorStatus;
  /**
   * 副标题（i18n key）：传输方式。
   * 两个 source 都会设置，所以是必填 —— 可选只会让每处使用都要判空。
   */
  summary: string;
}

export interface ConnectorEntry {
  /** 稳定唯一键："mcp:catalog:notion" / "mcp:builtin:Chrome" / "mcp:server:<name>" */
  key: string;
  /**
   * 这条目对应 `mcp.json` 里的 server 名（未添加时也有效）。
   * 能力 tab 的开关在"还没添加"时就要能打开，所以名字不能只存在于 instances 里。
   */
  serverName: string;
  source: ConnectorSourceId;
  tab: ConnectorTab;
  nameKey: string;
  descriptionKey?: string;
  instances: ConnectorInstance[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /**
   * 配置已写入，但当前没有活跃会话，所以还没真正连上 —— 下次对话才生效。
   * 没有这个标记时，用户会觉得「点了没反应」。
   */
  pendingActivation?: boolean;
}

/** 设置页「MCP 服务（高级）」用的添加形态。两种缺一不可，否则丢掉 stdio 添加能力。 */
export type AddCustomServerInput =
  | { kind: "url"; name: string; url: string }
  | { kind: "json"; payload: string };
