import { describe, expect, it } from "vitest";
import type { ChannelAdapter } from "../channel-adapter";

function createAdapter(): ChannelAdapter {
  return {
    channelType: "telegram",
    channelInstanceId: "telegram-1",
    generation: 1,
    connected: false,
    connect: async () => undefined,
    disconnect: async () => undefined,
    send: async (message) => ({
      version: 1,
      generation: message.generation,
      accepted: true,
      committed: true,
      outcome: "committed",
      idempotencyKey: message.idempotencyKey,
    }),
    onMessage: () => () => undefined,
    onCommand: () => () => undefined,
    onInteraction: () => () => undefined,
    onStatus: () => () => undefined,
    onError: () => () => undefined,
  };
}

describe("channel adapter contract", () => {
  it("requires unsubscribe functions for every event subscription", () => {
    const adapter = createAdapter();
    expect(adapter.onMessage(() => undefined)).toBeTypeOf("function");
    expect(adapter.onStatus(() => undefined)).toBeTypeOf("function");
  });
});
