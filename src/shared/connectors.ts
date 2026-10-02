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

export type ConnectorSourceId = "mcp-remote" | "mcp-builtin" | "mcp-custom";

export type ConnectorStatus =
  | { kind: "ready" }
  /** 已配置，但运行时没有任何状态 —— 也就是「没在连、也没连上」。
   *  不能拿它冒充 `connecting`：那会让卡片永远显示「进行中」且无处可退。 */
  | { kind: "idle" }
  /** 凭据已在本地（用户授权过了），只是运行时还没连上 —— 通常是等下次会话。
   *  不区分它和 `idle` 的话，刚授权成功的用户会看到「未连接」，以为失败了。 */
  | { kind: "authorized" }
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
  /**
   * 传输方式 —— **决定卡片给什么动作与标记**。
   *
   * `http` 是远程服务：「连接」= OAuth 授权，「断开」= 移除配置。
   * `stdio` 是本机进程：会话启动时连接，没有独立授权步骤，动作只能是**启用/停用**。
   *
   * **放在 entry 级而不是 instance 级**：未添加的内置条目 `instances` 为空，
   * 而卡片那时也要画对动作（开关而非「连接」）。用 `summary` 的 i18n key 反推是不行的 ——
   * 那是展示字符串，改文案就静默坏掉。
   */
  transport: "stdio" | "http";
  nameKey: string;
  descriptionKey?: string;
  instances: ConnectorInstance[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** 用户主动中止授权，不作为连接失败展示。 */
  cancelled?: boolean;
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
