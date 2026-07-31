/**
 * IPC type definitions shared between the main process and the renderer/preload.
 *
 * Goals:
 *  - Eliminate `any` from preload/index.ts
 *  - Keep types minimal and structural (no runtime overhead)
 *  - Re-export from existing modules where possible; define locally only when
 *    the originating module lives in `main/` (not importable from renderer/preload).
 */

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
    credits_balance: number;
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
