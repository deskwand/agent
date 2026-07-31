import type {
  ChannelCommand,
  ChannelInteraction,
  ChannelInteractionResponse,
  ChannelPairingEvent,
  ChannelStatusEvent,
  ChannelTarget,
  DeliveryResult,
  FileAttachment,
  OutboundMessage,
  ReactionEvent,
  ReactionUpdate,
  RuntimeChannelType,
  StreamUpdate,
  UnifiedMessage,
} from "./contracts";

export interface ChannelAdapterConfig {
  channelType: RuntimeChannelType;
  channelInstanceId: string;
  agentId: string;
  settings: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly channelType: RuntimeChannelType;
  readonly channelInstanceId: string;
  readonly generation: number;
  readonly connected: boolean;

  connect(signal: AbortSignal): Promise<void>;
  disconnect(options?: { reason: string; timeoutMs: number }): Promise<void>;

  send(message: OutboundMessage): Promise<DeliveryResult>;
  sendTyping?(target: ChannelTarget): Promise<void>;
  sendFile?(
    target: ChannelTarget,
    file: FileAttachment,
    idempotencyKey: string,
  ): Promise<DeliveryResult>;
  respondInteraction?(
    response: ChannelInteractionResponse,
  ): Promise<DeliveryResult>;
  setReaction?(
    target: ChannelTarget,
    reaction: ReactionUpdate,
  ): Promise<DeliveryResult>;

  streamUpdate?(
    target: ChannelTarget,
    update: StreamUpdate,
  ): Promise<DeliveryResult>;
  streamComplete?(
    target: ChannelTarget,
    finalText: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult>;
  streamError?(
    target: ChannelTarget,
    error: string,
    idempotencyKey: string,
  ): Promise<DeliveryResult>;
  lookupDelivery?(idempotencyKey: string): Promise<DeliveryResult>;

  onMessage(handler: (message: UnifiedMessage) => void): () => void;
  onCommand(handler: (command: ChannelCommand) => void): () => void;
  onInteraction(handler: (interaction: ChannelInteraction) => void): () => void;
  onReaction?(handler: (reaction: ReactionEvent) => void): () => void;
  onPairing?(
    handler: (event: ChannelPairingEvent) => void,
  ): () => void;
  onStatus(handler: (status: ChannelStatusEvent) => void): () => void;
  onError(handler: (error: Error) => void): () => void;

  downloadAttachment?(
    sourceRef: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
}

export type ChannelAdapterFactory = (
  config: ChannelAdapterConfig,
  generation: number,
) => ChannelAdapter;
