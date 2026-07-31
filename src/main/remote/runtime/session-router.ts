import { randomUUID } from "node:crypto";
import type { UnifiedMessage } from "./contracts";

export interface ChannelSessionBinding {
  version: 1;
  generation: number;
  agentId: string;
  channelInstanceId: string;
  chatId: string;
  userId: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionPersistencePort {
  getSessionBinding(bindingKey: string): ChannelSessionBinding | undefined;
  upsertSessionBinding(binding: ChannelSessionBinding): void;
}

export interface SessionRouterOptions {
  agentId: string;
  /** Optional persistence so bindings survive restart */
  persistence?: SessionPersistencePort;
}

export class SessionRouter {
  private readonly bindings = new Map<string, ChannelSessionBinding>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: SessionRouterOptions) {}

  /** Returns true when a session ID is a generated placeholder (starts with `remote-`). */
  static isPlaceholderSessionId(sessionId: string): boolean {
    return sessionId.startsWith("remote-");
  }

  async resolveSession(message: UnifiedMessage): Promise<ChannelSessionBinding> {
    const key = this.bindingKey(message);

    // Check in-memory cache first
    const cached = this.bindings.get(key);
    if (cached) {
      cached.updatedAt = Date.now();
      this.options.persistence?.upsertSessionBinding(cached);
      return cached;
    }

    // Check persistence (survives restart)
    const persisted = this.options.persistence?.getSessionBinding(key);
    if (persisted) {
      persisted.updatedAt = Date.now();
      this.bindings.set(key, persisted);
      this.options.persistence?.upsertSessionBinding(persisted);
      return persisted;
    }

    const now = Date.now();
    const binding: ChannelSessionBinding = {
      version: 1,
      generation: message.generation,
      agentId: this.options.agentId,
      channelInstanceId: message.channelInstanceId,
      chatId: message.chatId,
      userId: message.userId,
      sessionId: `remote-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };

    this.bindings.set(key, binding);
    this.options.persistence?.upsertSessionBinding(binding);
    return binding;
  }

  enqueue(binding: ChannelSessionBinding, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(binding.sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(binding.sessionId, next);
    void next.then(
      () => this.clearQueueIfCurrent(next),
      () => this.clearQueueIfCurrent(next),
    );
    return next;
  }

  /**
   * Replace the placeholder session ID (e.g. `remote-<uuid>`) with the
   * actual Agent session ID returned by startSession. The old binding
   * is removed and a new immutable binding is created and persisted.
   * The queue key is migrated so any in-flight queue continues to work.
   */
  replaceSessionBinding(
    oldBinding: ChannelSessionBinding,
    actualSessionId: string,
  ): ChannelSessionBinding {
    const key = JSON.stringify([
      oldBinding.agentId,
      oldBinding.channelInstanceId,
      oldBinding.chatId,
      oldBinding.userId,
    ]);
    const queue = this.queues.get(oldBinding.sessionId);

    const now = Date.now();
    const newBinding: ChannelSessionBinding = {
      version: 1,
      generation: oldBinding.generation,
      agentId: oldBinding.agentId,
      channelInstanceId: oldBinding.channelInstanceId,
      chatId: oldBinding.chatId,
      userId: oldBinding.userId,
      sessionId: actualSessionId,
      createdAt: oldBinding.createdAt,
      updatedAt: now,
    };

    this.bindings.delete(key);
    this.queues.delete(oldBinding.sessionId);

    this.bindings.set(key, newBinding);
    if (queue) {
      this.queues.set(actualSessionId, queue);
    }

    this.options.persistence?.upsertSessionBinding(newBinding);
    return newBinding;
  }

  clear(binding: ChannelSessionBinding): void {
    this.bindings.delete(
      JSON.stringify([
        binding.agentId,
        binding.channelInstanceId,
        binding.chatId,
        binding.userId,
      ]),
    );
    this.queues.delete(binding.sessionId);
  }

  private clearQueueIfCurrent(promise: Promise<void>): void {
    for (const [sessionId, queued] of this.queues) {
      if (queued === promise) this.queues.delete(sessionId);
    }
  }

  private bindingKey(message: UnifiedMessage): string {
    return JSON.stringify([
      this.options.agentId,
      message.channelInstanceId,
      message.chatId,
      message.userId,
    ]);
  }
}
