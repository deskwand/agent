import { describe, expect, it } from "vitest";
import { createDeskwandToolsExtension } from "../../src/main/agent/subagent/deskwand-tools-extension";

describe("createDeskwandToolsExtension", () => {
  it("returns an object with name and factory for valid cwd", () => {
    const ext = createDeskwandToolsExtension("/tmp/ws", "session-1");
    expect(ext).toBeDefined();
    if (ext) {
      const obj = ext as { name?: string; factory?: unknown };
      expect(obj.name).toBe("deskwand-tools");
      expect(typeof obj.factory).toBe("function");
    }
  });

  it("returns undefined when cwd is empty", () => {
    expect(createDeskwandToolsExtension("", "session-1")).toBeUndefined();
  });

  it("returns undefined when sessionId is empty", () => {
    expect(createDeskwandToolsExtension("/tmp/ws", "")).toBeUndefined();
  });

  it("factory registers all tools when called with custom tools", () => {
    const ext = createDeskwandToolsExtension("/tmp/ws", "session-1", [
      { name: "mcp_search", description: "Search MCP", parameters: {} as any, execute: async () => ({ content: [] }) },
    ], [
      { name: "read", description: "Read file", parameters: {} as any, execute: async () => ({ content: [] }) },
    ]);
    expect(ext).toBeDefined();
    if (ext) {
      const obj = ext as {
        name: string;
        factory: (pi: Record<string, unknown>) => void;
      };
      const registered: Array<{ name: string }> = [];
      const mockPi = {
        registerTool: (tool: { name: string }) => {
          registered.push(tool);
        },
      };
      obj.factory(mockPi);
      const names = registered.map((t) => t.name);
      expect(names).toContain("read");
      expect(names).toContain("mcp_search");
    }
  });
});
