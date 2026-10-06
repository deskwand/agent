import type { EngineInstallState } from "./engine-install";
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

/** Configuration for a single MCP server (mirrors MCPServerConfig in mcp-config-store.ts). */
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
  status: "connecting" | "connected" | "needs-auth" | "failed" | "disabled";
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
  state:
    | "stopped"
    | "starting"
    | "connected"
    | "reconnecting"
    | "failed"
    | "draining"
    | "stopping";
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
export type PiMarketType =
  | "extension"
  | "skill"
  | "prompt"
  | "theme"
  | "package";

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

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export type VoiceErrorCode =
  | "VOICE_NOT_CONFIGURED"
  | "VOICE_NOT_INSTALLED"
  | "VOICE_ENGINE_FAILED"
  | "VOICE_MIC_DENIED"
  | "VOICE_MIC_UNAVAILABLE"
  | "VOICE_CAPTURE_FAILED"
  | "VOICE_INSTALL_FAILED";

export type VoiceStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: VoiceErrorCode };

/** VAD 边沿。主进程报，渲染层消费。 */
export type VadEdge = "speech-start" | "speech-end";

/** VAD 的灵敏度档位。`barge-in` 用于回答期，对抗扬声器残留。 */
export type VadProfile = "interactive" | "barge-in";

export type VoiceInstallPhase =
  | "idle"
  | "downloading"
  | "extracting"
  | "ready"
  | "error";

export interface VoiceInstallState {
  phase: VoiceInstallPhase;
  /** 0-100。 */
  percent: number;
  installed: boolean;
  error?: string;
}

export interface VoicePolishedResult {
  ok: boolean;
  text?: string;
  reason?: "empty" | "failed" | "suspicious";
}

/**
 * `voice.event` 通道的推送载荷。
 *
 * `partial.text` 是**累积全量文本**，不是增量：渲染层只做替换，不做拼接，
 * 于是 UI 永远不会显示拼错的中间态。
 */
export type VoiceEvent =
  | { type: "partial"; sessionId: string; text: string }
  | { type: "done"; sessionId: string; text: string; discarded: boolean }
  | { type: "error"; sessionId: string; code: VoiceErrorCode; message: string }
  | { type: "install"; state: VoiceInstallState }
  /**
   * VAD 边沿。**不带 sessionId** —— 朗读期没有 ASR 会话，而那时正是最需要
   * 它的时刻（判断用户有没有开口打断）。渲染层的 sessionId 过滤器要为它让路。
   */
  | { type: "vad"; edge: VadEdge };

// ---------------------------------------------------------------------------
// TTS / read aloud（朗读）
// ---------------------------------------------------------------------------

/**
 * 三个语音模型的键。主进程与渲染层共用这一个名字。
 *
 * `"matcha"` 是语音模式的高速音色（朗读那两张卡看不到它）。
 */
export type TtsModelKey = "zh" | "en" | "matcha";

export type TtsInstallPhase =
  | "idle"
  | "downloading"
  | "extracting"
  | "ready"
  | "error";

export interface TtsInstallState {
  phase: TtsInstallPhase;
  /** 0-100。 */
  percent: number;
  installed: boolean;
  /** 原始错误信息。失败时给用户看的就是它（不做三种失败各写一条文案）。 */
  error?: string;
}

/** 三个模型各自的状态。渲染层每行各读一行。 */
export interface TtsInstallStates {
  zh: TtsInstallState;
  en: TtsInstallState;
  matcha: TtsInstallState;
}

/**
 * speak 的引擎选择。两个入参语义不同，**不要合并**：
 *
 * - `engine`：硬指定（安装自检用）。指定的没装就报错。
 * - `prefer`：软偏好（语音模式用）。没装就回退到按文本路由。
 *
 * 一个参数两种期望 = 迟早改错一个：自检需要"没装就报错"才能把半装的模型撤掉，
 * 语音模式需要"没装就照旧出声"。
 */
/**
 * 语音模式的三档音色。
 *
 * - `fast`：高速音色（matcha）
 * - `balanced`：按文本路由到朗读的中文 / 英文音色
 * - `best`：本地引擎（大模型，走流式）—— 与 `prefer` 不同，它**不是**模型键，
 *   因为它不是 sherpa 的模型；引擎是否可用由主进程单独判（见 engine-host）。
 */
export type TtsTone = "fast" | "balanced" | "best";

export interface TtsSpeakOptions {
  engine?: TtsModelKey;
  prefer?: TtsModelKey;
  /**
   * 谁在说话。`"voice"` 是语音对话。它点名要的音色不该再被朗读开关拦住：
   * 语音对话的音色是用户在这张卡里单独选的（快速 / 均衡），与聊天里的朗读无关。
   *
   * **它不放宽任何权限**：渲染层本来就能写 `readAloud.enabled`（`config.save`），
   * 也能直接指定 `engine`。门控只是一道一致性守卫，不是安全边界 —— `purpose`
   * 在线上也没有校验。
   */
  purpose?: "voice";
  /**
   * 语音模式的三档音色。**与 `prefer` 并存**：`prefer` 是给老调用点的软偏好，
   * `tone` 是设置页那一栏的三档语义。两者都给时以 `tone` 为准。
   */
  tone?: TtsTone;
}

export type TtsSpeakResult =
  | { ok: true; samples: Float32Array; sampleRate: number }
  | { ok: false; error: string };

export type TtsEvent =
  | {
      type: "install";
      /** 哪个模型。两行各自更新，不能只更新第一行。 */
      model: TtsModelKey;
      state: TtsInstallState;
    }
  /** 引擎（最佳音质档）的安装进度。与上面那个分开：它没有 model 键。 */
  | { type: "engine"; state: EngineInstallState };

/**
 * 流式朗读的块事件。块 = 引擎的一个**标点分段**（不是音频级流式）；分块拼接
 * 起来与整句音频逐样本相同。
 */
export type TtsStreamEvent =
  | {
      streamId: number;
      type: "chunk";
      /** 自增序号，从 0 开始。 */
      seq: number;
      samples: Float32Array;
      sampleRate: number;
    }
  | { streamId: number; type: "done" }
  | { streamId: number; type: "error"; error: string };

export interface TtsSpeakStreamResult {
  streamId: number;
}

export type OcrInstallState = {
  phase: "idle" | "downloading" | "extracting" | "ready" | "error";
  percent: number;
  installed: boolean;
  error?: string;
};

export type OcrEvent = {
  type: "install";
  state: OcrInstallState;
};
