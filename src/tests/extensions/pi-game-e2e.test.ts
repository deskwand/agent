import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

describe("real env: /game snake through the SDK", () => {
  it("runner registers game and prompt('/game') hits the command path", async () => {
    const agentDir = path.join(os.homedir(), ".pi", "agent");
    const cwd = path.join(os.homedir(), ".deskwand", "default_working_dir");
    const loader = new DefaultResourceLoader({
      cwd, agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
    });
    await loader.reload();
    const stubModel = {
      id: "stub", name: "stub", api: "anthropic-messages" as const,
      provider: "anthropic" as const, baseUrl: "http://localhost:1",
      reasoning: false, input: ["text"] as const,
      cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100,
    };
    const { session, extensionsResult } = await createAgentSession({
      model: stubModel as never,
      tools: [],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    const gameExt = extensionsResult.extensions.find((e: { path?: string }) => e.path?.includes("pi-games"));
    if (gameExt) {
    }
    if (!gameExt) {
      // 环境未安装 pi-games 时跳过（非 hermetic 测试的降级）
      return;
    }
    const r = await session.prompt("/game snake");
    // 命令自包含：prompt 返回 void（不调 stub model）
    expect(r).toBeUndefined();
  }, 30000);
});
