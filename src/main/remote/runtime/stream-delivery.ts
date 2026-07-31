import type { ChannelAdapter } from "./channel-adapter";
import type {
  ChannelTarget,
  DeliveryResult,
  OutboundMessage,
  StreamUpdate,
} from "./contracts";
import type { ChannelRuntimePersistence } from "./persistence";

interface StreamState {
  lastSequence: number;
  finalIdempotencyKey?: string;
  committed: boolean;
}

export class StreamDelivery {
  private readonly states = new Map<string, StreamState>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly persistence?: ChannelRuntimePersistence;
  private readonly hydrated = new Set<string>();
  private generation = 1;
  private channelInstanceId = "";
  private chatId = "";

  constructor(
    private readonly adapter: ChannelAdapter,
    persistence?: ChannelRuntimePersistence,
  ) {
    this.persistence = persistence;
    this.generation = Number.isInteger(adapter.generation)
      ? adapter.generation
      : 0;
    this.channelInstanceId = adapter.channelInstanceId ?? "";
  }

  update(update: StreamUpdate): Promise<DeliveryResult | undefined> {
    const previous = this.queues.get(update.streamId) ?? Promise.resolve();
    const current = previous.then(
      () => this.updateNow(update),
      () => this.updateNow(update),
    );
    this.queues.set(
      update.streamId,
      current.then(() => undefined, () => undefined),
    );
    return current;
  }

  private getStreamState(streamId: string): StreamState {
    const cached = this.states.get(streamId);
    if (cached) return cached;

    // Lazy hydrate from persistence on first access per instance.
    if (this.persistence && !this.hydrated.has(streamId)) {
      this.hydrated.add(streamId);
      const persisted = this.persistence.getStreamState(streamId);
      if (persisted) {
        const state: StreamState = {
          lastSequence: persisted.lastSequence,
          finalIdempotencyKey: persisted.finalIdempotencyKey,
          committed: persisted.committed,
        };
        this.states.set(streamId, state);
        return state;
      }
    }

    const fresh: StreamState = {
      lastSequence: -1,
      committed: false,
    };
    this.states.set(streamId, fresh);
    return fresh;
  }

  private setStreamState(streamId: string, state: StreamState): void {
    this.states.set(streamId, state);
    if (this.persistence) {
      this.persistence.upsertStreamState({
        version: 1,
        generation: this.generation,
        streamId,
        channelInstanceId: this.channelInstanceId,
        chatId: this.chatId,
        lastSequence: state.lastSequence,
        state: state.committed ? "completed" : "active",
        finalIdempotencyKey: state.finalIdempotencyKey,
        committed: state.committed,
        updatedAt: Date.now(),
      });
    }
  }

  private async updateNow(
    update: StreamUpdate,
  ): Promise<DeliveryResult | undefined> {
    this.generation = update.generation;
    this.channelInstanceId = update.target.channelInstanceId;
    this.chatId = update.target.chatId;
    const state = this.getStreamState(update.streamId);
    if (state.committed || update.sequence <= state.lastSequence) {
      return undefined;
    }

    if (!this.adapter.streamUpdate) {
      state.lastSequence = update.sequence;
      this.setStreamState(update.streamId, state);
      return undefined;
    }

    const result = await this.adapter.streamUpdate(update.target, update);
    if (
      result.outcome === "committed" ||
      result.outcome === "accepted" ||
      result.outcome === "permanent_failure"
    ) {
      state.lastSequence = update.sequence;
      this.setStreamState(update.streamId, state);
    }
    return result;
  }

  async complete(
    streamId: string,
    target: ChannelTarget,
    finalText: string,
    idempotencyKey: string,
    generation: number,
  ): Promise<DeliveryResult> {
    this.generation = generation;
    this.channelInstanceId = target.channelInstanceId;
    this.chatId = target.chatId;
    const state = this.getStreamState(streamId);
    if (state.committed && state.finalIdempotencyKey === idempotencyKey) {
      return {
        version: 1,
        generation,
        accepted: true,
        committed: true,
        outcome: "committed",
        idempotencyKey,
      };
    }

    const result = this.adapter.streamComplete
      ? await this.adapter.streamComplete(target, finalText, idempotencyKey)
      : await this.adapter.send(this.finalMessage(target, finalText, idempotencyKey, generation));
    if (result.outcome === "committed") {
      state.committed = true;
      state.finalIdempotencyKey = idempotencyKey;
      this.setStreamState(streamId, state);
    }
    return result;
  }

  /**
   * Set the chat ID for persistence. Called by Bootstrap when the
   * delivery is first created with a known chat context.
   */
  setChatId(id: string): void {
    this.chatId = id;
  }

  cancel(streamId: string): void {
    this.states.delete(streamId);
    if (this.persistence) {
      this.persistence.upsertStreamState({
        version: 1,
        generation: this.generation,
        streamId,
        channelInstanceId: this.channelInstanceId,
        chatId: this.chatId,
        lastSequence: -1,
        state: "cancelled",
        committed: false,
        updatedAt: Date.now(),
      });
    }
  }

  private finalMessage(
    target: ChannelTarget,
    finalText: string,
    idempotencyKey: string,
    generation: number,
  ): OutboundMessage {
    return {
      version: 1,
      generation,
      idempotencyKey,
      target,
      text: finalText,
      kind: "reply",
    };
  }
}
