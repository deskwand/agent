import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  AGENT_TOOL_NAME,
  registerAgentNameHook,
} from "../../main/agent/subagent/agent-name-hook";

type ToolCallHandler = (event: {
  toolName: string;
  input: Record<string, unknown>;
}) => void;

function harness() {
  const handlers = new Map<string, ToolCallHandler>();
  const pi = {
    on: (channel: string, handler: ToolCallHandler) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
  } as unknown as ExtensionAPI;
  registerAgentNameHook(pi);
  return handlers.get("tool_call") as ToolCallHandler;
}

describe("registerAgentNameHook", () => {
  it("模型没给名字时补一个合法兜底名", () => {
    const handler = harness();
    const input: Record<string, unknown> = { subagent_type: "Explore" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(String(input.name)).toMatch(/^[a-z0-9_-]+$/);
  });

  it("模型给了中文名时替换成合法名", () => {
    const handler = harness();
    const input: Record<string, unknown> = { name: "图灵" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(input.name).not.toBe("图灵");
    expect(String(input.name)).toMatch(/^[a-z0-9_-]+$/);
  });

  it("模型给了合法 ASCII 名时原样保留", () => {
    const handler = harness();
    const input: Record<string, unknown> = { name: "auth-audit" };
    handler({ toolName: AGENT_TOOL_NAME, input });
    expect(input.name).toBe("auth-audit");
  });

  it("非 Agent 工具不碰", () => {
    const handler = harness();
    const input: Record<string, unknown> = { command: "ls" };
    handler({ toolName: "bash", input });
    expect(input.name).toBeUndefined();
  });
});
