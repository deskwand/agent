/**
 * IPC type definitions shared between the main process and the renderer/preload.
 *
 * Goals:
 *  - Eliminate `any` from preload/index.ts
 *  - Keep types minimal and structural (no runtime overhead)
 *  - Re-export from existing modules where possible; define locally only when
 *    the originating module lives in `main/` (not importable from renderer/preload).
 */

import type { PromptCommandNameError } from "./prompt-command-name";

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/** Configuration for a single MCP server (mirrors MCPServerConfig in mcp-manager.ts). */
export interface McpServerConfig {
  id: string;
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/** Tool exposed by an MCP server (mirrors MCPTool in mcp-manager.ts). */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

/** Runtime status of a single MCP server. */
export interface McpServerStatus {
  id: string;
  name: string;
  connected: boolean;
  status: "connecting" | "connected" | "failed" | "disabled";
  toolCount: number;
}

/**
 * Preset MCP server configs returned by `mcp.getPresets`.
 * Each value is a partial MCPServerConfig (without `id` and `enabled`).
 */
export type McpPresetsMap = Record<
  string,
  Omit<McpServerConfig, "id" | "enabled"> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
>;

// ---------------------------------------------------------------------------
// Remote
// ---------------------------------------------------------------------------

/** Slim channel-type union (mirrors ChannelType in remote/types.ts). */
export type RemoteChannelType =
  | "feishu"
  | "wechat"
  | "telegram"
  | "discord"
  | "qq"
  | "slack"
  | "dingtalk"
  | "websocket";

/** Feishu channel configuration (mirrors FeishuChannelConfig in remote/types.ts). */
export interface FeishuChannelConfig {
  type: "feishu";
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  useWebSocket?: boolean;
  dm: {
    policy: "open" | "pairing" | "allowlist";
    allowFrom?: string[];
  };
  groups?: Record<string, { requireMention: boolean; allowFrom?: string[] }>;
  defaultGroupSettings?: { requireMention: boolean };
}

/** Full remote configuration returned by remote.getConfig. */
export interface RemoteConfig {
  channels: {
    feishu?: FeishuChannelConfig;
    wechat?: Record<string, unknown>;
    telegram?: Record<string, unknown>;
    dingtalk?: Record<string, unknown>;
    websocket?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** Result of an OAuth status query. */
export interface OAuthStatusResult {
  loggedIn: boolean;
  expiresAt?: number;
  providerName: string;
}

export interface OpenRouterAuthStatusResult {
  loggedIn: boolean;
  providerName: string;
}

export interface OpenRouterLoginResult {
  apiKey: string;
  providerName: string;
}

export interface OpenRouterModelsResult {
  models: Array<{
    id: string;
    label: string;
    source: "preset" | "custom";
    contextWindow?: number;
    maxTokens?: number;
    input?: ("text" | "image")[];
  }>;
  usedFallback: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Cloud Auth (Google OAuth)
// ---------------------------------------------------------------------------

/** Google OAuth 登录成功返回 */
export interface CloudAuthLoginResult {
  token: string;
  user: {
    email: string;
    level: string;
    balance_micro_usd: number;
  };
}

// ---------------------------------------------------------------------------
// Channel Instance Configuration & Status (Task 13)
// ---------------------------------------------------------------------------

/** Channel types supported by the independent runtime. */
export type ChannelRuntimeInstanceType =
  | "feishu"
  | "wechat"
  | "telegram"
  | "discord"
  | "qq"
  | "slack";

/** A single channel instance (named configuration of a channel type). */
export interface ChannelInstanceConfig {
  id: string;
  name: string;
  type: ChannelRuntimeInstanceType;
  enabled: boolean;
  /** Type-specific config with credentials masked when returned to renderer. */
  config: Record<string, unknown>;
}

/** Runtime status of a single channel instance. */
export interface ChannelInstanceStatus {
  id: string;
  name: string;
  type: ChannelRuntimeInstanceType;
  enabled: boolean;
  connected: boolean;
  state: "stopped" | "starting" | "connected" | "reconnecting" | "failed" | "draining" | "stopping";
  error?: string;
  lastActiveAt?: number;
}

/** Policy configuration for a channel instance. */
export interface ChannelInstancePolicy {
  dmPolicy: "open" | "pairing" | "allowlist";
  requireMention?: boolean;
  allowFrom?: string[];
}

/** A log entry for a channel instance. */
export interface ChannelInstanceLog {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  instanceId: string;
}

// ---------------------------------------------------------------------------
// Channel Pairing
// ---------------------------------------------------------------------------

/** Pairing event emitted during channel login flows (e.g. WeChat QR). */
export interface ChannelPairingEvent {
  version: 1;
  channelType: ChannelRuntimeInstanceType;
  channelInstanceId: string;
  generation: number;
  state: "pending" | "scanned" | "confirmed" | "expired" | "failed";
  imageUrl?: string;
  errorCode?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Pi Extension
// ---------------------------------------------------------------------------

/** 已加载的 Pi 扩展信息（用于管理界面展示）。 */
export interface PiExtensionInfo {
  path: string;
  source: string;
  scope: string;
  origin: string;
  error?: string;
}

/** 项目信任询问请求（main → renderer）。 */
export interface PiTrustPrompt {
  cwd: string;
}

/** 用户对信任询问的响应（renderer → main）。 */
export type PiTrustResponse = "trusted" | "untrusted" | "cancel";

/** 扩展 UI 对话框请求（复用官方 RPC extension_ui_request 形状）。 */
export interface PiUiRequest {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

/** 已配置的 Pi 包（管理界面展示）。 */
export interface PiPackageDto {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
  type: "npm" | "git" | "local";
}

/** Pi 扩展管理界面完整状态。 */
export interface PiExtensionManagerState {
  sdkVersion: string;
  packages: PiPackageDto[];
  extensions: PiExtensionInfo[];
  errors: { path: string; error: string }[];
}

/** TUI Modal 打开事件（main → renderer）。 */
export interface PiTuiOpenEvent {
  width: number;
  height: number;
  title?: string;
}

/** TUI Modal 渲染帧（main → renderer，已按帧批量）。 */
export interface PiTuiFrameEvent {
  chunk: string;
}

/** 统一命令注册表条目（内置 / 扩展 / 提示词模板，镜像 PiCommandEntry）。 */
export interface PiCommandDto {
  name: string;
  description?: string;
  source: "builtin" | "extension" | "prompt";
  /** 提示词模板的显示名（frontmatter display_name）；仅 source === "prompt" 可能有 */
  displayName?: string;
  /** 提示词模板位于全局 ~/.pi/agent/prompts —— 可在「+」菜单里编辑/删除 */
  editable?: boolean;
}

/** 自定义命令的完整内容（编辑表单回填）。 */
export interface PromptCommandDto {
  name: string;
  displayName?: string;
  content: string;
}

/** `prompts.save` 的入参。没有任何「描述」字段 —— 表单不管它（见设计文档 §4.5）。 */
export interface PromptCommandSaveInput {
  name: string;
  displayName?: string;
  content: string;
}

/**
 * `prompts.save` / `prompts.delete` 的返回。
 * error 是校验失败原因或 "io" / "notFound"，renderer 侧映射成文案。
 * 联合类型放这里（而不是在 renderer 里 as 回去）—— main 的 handler、renderer 的表单共用同一份。
 */
export type PromptCommandSaveError =
  | PromptCommandNameError
  | "exists"
  | "io"
  | "notFound";

export type PromptCommandSaveResult =
  | { ok: true }
  | { ok: false; error: PromptCommandSaveError };

/** `commands.list` 的返回结构。 */
export interface PiCommandListDto {
  commands: PiCommandDto[];
}

// ---------------------------------------------------------------------------
// Pi Market
// ---------------------------------------------------------------------------

/** Pi 市场条目类型（由 npm keywords 推导，镜像 PiMarketService.PiPackageType）。 */
export type PiMarketType = "extension" | "skill" | "prompt" | "theme" | "package";

/** Pi 市场搜索结果条目（镜像 PiMarketService.PiMarketPackage）。 */
export interface PiMarketPackageDto {
  name: string;
  description: string;
  version: string;
  author?: string;
  date?: string;
  type: PiMarketType;
}

/** Pi 市场搜索结果（镜像 PiMarketService.PiMarketSearchResult）。 */
export interface PiMarketSearchResultDto {
  total: number;
  objects: PiMarketPackageDto[];
}

/** Pi 市场包详情（镜像 PiMarketService.PiMarketDetail）。 */
export interface PiMarketDetailDto extends PiMarketPackageDto {
  gallery?: { video?: string; image?: string };
  repository?: string;
  homepage?: string;
}

// ---------------------------------------------------------------------------
// 浏览器元素拾取（Design Mode v1）
// ---------------------------------------------------------------------------

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatchedCssRule {
  selector: string;
  /**
   * CDP 没有「构造样式表」这个概念（StyleSheetOrigin 只有 regular / user-agent /
   * injected / inspector），所以没有 constructed —— 无 URL 的规则仍按 regular 处理，
   * 不伪造本地文件来源。user-agent 规则在映射阶段即被丢弃，不会出现在这里。
   */
  origin: "regular" | "inline" | "attribute";
  /** 由 CSS.styleSheetAdded 的 header 解析而来；inline / attribute 可能为空 */
  sourceUrl?: string;
  /** 去掉 origin 与 query 的 site-root 相对路径，如 /src/styles/button.css */
  siteRelativePath?: string;
  /** 0-based（CDP 口径）；渲染进 prompt 时 +1 */
  line?: number;
  /** 原声明顺序；important 标志序列化到值中，不代表完整级联的获胜结果 */
  declarations: string[];
}

export interface ElementSelection {
  pageUrl: string;
  pageTitle: string;
  tag: string;
  classes: string[];
  text: string;
  outerHTML: string;
  role: string | null;
  accessibleName: string;
  selector: string;
  selectorUnique: boolean;
  domPath: string;
  matchedCss: MatchedCssRule[];
  computed: Record<string, string>;
  rect: ElementRect;
  parent: {
    selector: string;
    tag: string;
    display: string;
    gap?: string;
    rect: ElementRect;
  } | null;
  siblings: Array<{ tag: string; classes: string[]; rect: ElementRect }>;
  viewport: { width: number; height: number; dpr: number };
  scroll: { x: number; y: number };
}

/**
 * 元素拾取的启动结果。三条契约：`stop → void`、`highlight → boolean`。
 *
 * UI 必须**静默**处理 `{ ok: false }`（只把 toggle 回弹到未激活，不弹 toast、
 * 不按 reason 分支提示）：`"not-available"` 既表示"当前页不可拾取"、也表示
 * "启动途中被取消"，用户主动取消不是错误，按错误报就是假报错。
 */
export type PickerStartResult =
  | { ok: true }
  | { ok: false; reason: "not-available" | "attach-failed" };

/**
 * 元素引用的**展示投影**：气泡里回显一个元素引用只需要这些。
 *
 * 为什么不直接存整个 `ElementSelection`：那会把 `outerHTML` / `computed` /
 * `matchedCss` 在 JSONL 里再存一份（模型可见文本里已经有了），而展示用不到。
 * 这份投影同时用作宿主/渲染层消息字段与 SDK custom message 的 `details`。
 */
export interface ElementSelectionRef {
  pageUrl: string;
  tag: string;
  classes: string[];
  text: string;
  selector: string;
  selectorUnique: boolean;
  width: number;
  height: number;
}
