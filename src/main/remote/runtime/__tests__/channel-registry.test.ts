import { describe, expect, it, vi } from "vitest";
import type { ChannelAdapter } from "../channel-adapter";
import { ChannelRegistry } from "../channel-registry";

const adapter: ChannelAdapter = {
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

describe("channel registry", () => {
  it("creates an adapter from a registered factory", () => {
    const registry = new ChannelRegistry();
    const factory = vi.fn(() => adapter);
    registry.register("telegram", factory);

    expect(registry.create({
      channelType: "telegram",
      channelInstanceId: "telegram-1",
      agentId: "agent-1",
      settings: {},
    }, 1)).toBe(adapter);
    expect(factory).toHaveBeenCalledOnce();
  });
});
