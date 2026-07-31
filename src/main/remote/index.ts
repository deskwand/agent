/**
 * Remote Control Module
 * 远程控制模块导出
 */

// Types
export * from "./types";

// Core
export {
  RemoteManager,
  remoteManager,
  type AgentExecutor,
} from "./remote-manager";

// Channels
export { ChannelBase } from "./channels/channel-base";
export { FeishuChannel } from "./channels/feishu";

// Config
export { remoteConfigStore } from "./remote-config-store";

// Channel Runtime
export * from "./runtime/contracts";
export * from "./runtime/channel-adapter";
export { ChannelRegistry } from "./runtime/channel-registry";
export { ConnectionManager } from "./runtime/connection-manager";
export { ChannelRuntime } from "./runtime/channel-runtime";
export { AttachmentStore } from "./runtime/attachment-store";
export { NotificationRouter } from "./runtime/notification-router";
export { SessionRouter } from "./runtime/session-router";
export { StreamDelivery } from "./runtime/stream-delivery";
export { TelegramChannel, splitTelegramText } from "./channels/telegram/telegram-channel";
export { TelegramApi } from "./channels/telegram/telegram-api";
export { DiscordChannel, splitDiscordText } from "./channels/discord/discord-channel";
export { QqChannel } from "./channels/qq/qq-channel";
export {
  SlackRuntimeChannel,
  splitSlackText,
  verifySlackSignature,
} from "./channels/slack/slack-runtime-channel";
export { WeChatChannel } from "./channels/wechat/wechat-channel";
