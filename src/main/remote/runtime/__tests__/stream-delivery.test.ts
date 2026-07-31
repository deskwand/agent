import { describe, expect, it, vi } from "vitest";
import { StreamDelivery } from "../stream-delivery";
import type { ChannelAdapter } from "../channel-adapter";
import type { ChannelTarget } from "../contracts";

const target: ChannelTarget = {
  version: 1,
  channelType: "telegram",
  channelInstanceId: "telegram-1",
  chatId: "chat-1",
  visibility: "chat",
};

describe("stream delivery", () => {
  it("does not resend a committed final delivery", async () => {
    const adapter = {
      streamComplete: vi.fn(async () => ({
        version: 1 as const,
        generation: 1,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: "final-key",
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.complete("stream-1", target, "final text", "final-key", 1);
    await delivery.complete("stream-1", target, "final text", "final-key", 1);

    expect(adapter.streamComplete).toHaveBeenCalledTimes(1);
  });

  it("retries a sequence after a retryable delivery failure", async () => {
    const adapter = {
      streamUpdate: vi
        .fn()
        .mockResolvedValueOnce({
          version: 1 as const,
          generation: 1,
          accepted: false,
          committed: false,
          outcome: "retryable_failure" as const,
          idempotencyKey: "one",
        })
        .mockResolvedValueOnce({
          version: 1 as const,
          generation: 1,
          accepted: true,
          committed: true,
          outcome: "committed" as const,
          idempotencyKey: "one",
        }),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);
    const update = {
      version: 1 as const,
      generation: 1,
      streamId: "stream-retry",
      sequence: 1,
      target,
      fullText: "one",
      idempotencyKey: "one",
      isFinal: false,
    };

    await delivery.update(update);
    await delivery.update(update);

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(2);
  });

  it("drops duplicate and out-of-order updates", async () => {
    const adapter = {
      streamUpdate: vi.fn(async (update) => ({
        version: 1 as const,
        generation: update.generation,
        accepted: true,
        committed: true,
        outcome: "committed" as const,
        idempotencyKey: update.idempotencyKey,
      })),
    } as unknown as ChannelAdapter;
    const delivery = new StreamDelivery(adapter);

    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "stream-1",
      sequence: 2,
      target,
      fullText: "two",
      idempotencyKey: "two",
      isFinal: false,
    });
    await delivery.update({
      version: 1,
      generation: 1,
      streamId: "stream-1",
      sequence: 1,
      target,
      fullText: "one",
      idempotencyKey: "one",
      isFinal: false,
    });

    expect(adapter.streamUpdate).toHaveBeenCalledTimes(1);
  });
});
