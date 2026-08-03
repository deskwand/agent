import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";
import { createAgentSession } from "@earendil-works/pi-coding-agent";

function makeTempProject(): { dir: string; agentDir: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-loader-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  return { dir: project, agentDir };
}

describe("PiSessionLoader e2e", () => {
  let ctx: { dir: string; agentDir: string } | undefined;

  beforeEach(() => {
    ctx = makeTempProject();
    PiExtensionHost.registry.clear();
  });

  afterEach(() => {
    for (const host of [...PiExtensionHost.registry.values()]) host.dispose();
    PiExtensionHost.registry.clear();
  });

  it("Agent tool is exposed when session uses derived loader", async () => {
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    const loader = await host.createSessionResourceLoader([
      {
        name: "pi-subagents-wrapped",
        factory: (pi) => {
          pi.registerTool({
            name: "Agent",
            label: "Agent",
            description: "spawn a sub-agent",
            parameters: {},
            execute: async () => ({
              content: [{ type: "text", text: "ok" }],
              details: {},
            }),
          });
        },
      },
    ]);
    const { session } = await createAgentSession({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
      resourceLoader: loader,
    });
    // SDK 公开 API：getAllTools() 返回所有已配置工具（含扩展注册）。
    const toolNames = session.getAllTools().map((t) => t.name);
    expect(toolNames).toContain("Agent");
    await session.dispose();
  });
});
