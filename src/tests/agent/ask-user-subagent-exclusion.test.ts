import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createDeskwandToolsExtension } from "../../main/agent/subagent/deskwand-tools-extension";

function fakeTool(name: string): ToolDefinition {
  return { name } as unknown as ToolDefinition;
}

describe("deskwand tools extension (subagent)", () => {
  it("does not register ask_user for subagents", () => {
    const ext = createDeskwandToolsExtension(
      "/tmp",
      "s-1",
      [fakeTool("read"), fakeTool("ask_user")],
      [],
    );
    const registered: string[] = [];
    const fakePi = {
      registerTool: (t: ToolDefinition) => {
        registered.push(t.name);
      },
    };
    // InlineExtension 是「函数 | { factory }」联合类型，需先窄化再取出 factory
    const factory = typeof ext === "function" ? ext : ext?.factory;
    factory?.(fakePi as never);
    expect(registered).toContain("read");
    expect(registered).not.toContain("ask_user");
  });
});
