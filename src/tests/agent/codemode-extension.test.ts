import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";

// 配置由 mock 控制，这样同一个用例文件能同时覆盖开 / 关两种状态。
let codemodeConfig = normalizeCodemodeConfig(undefined);
vi.mock("../../main/config/config-store", () => ({
  configStore: {
    get: (key: string) => (key === "codemode" ? codemodeConfig : undefined),
    getAll: () => ({ codemode: codemodeConfig }),
  },
}));

function makeTempProject(): { dir: string; agentDir: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codemode-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  return { dir: project, agentDir };
}

async function buildSession(ctx: { dir: string; agentDir: string }) {
  const { PiExtensionHost } =
    await import("../../main/extensions/pi-extension-host");
  const { createAgentSession } =
    await import("@earendil-works/pi-coding-agent");
  const { createDeskwandCodemodeExtension } =
    await import("../../main/agent/codemode-extension");
  const host = PiExtensionHost.getOrCreate({
    cwd: ctx.dir,
    agentDir: ctx.agentDir,
  });
  await host.reloadResources();
  const loader = await host.createSessionResourceLoader([
    createDeskwandCodemodeExtension(),
  ]);
  const { session } = await createAgentSession({
    cwd: ctx.dir,
    agentDir: ctx.agentDir,
    resourceLoader: loader,
  });
  return session;
}

/**
 * codemode 的**行为**断言（设计 §3.4）。
 *
 * 注册与激活都是同步的（不依赖子进程/网络），所以这里可以可靠断言 ——
 * 不像「MCP 工具对模型可见」那条（需要真实建连，在 vitest 里做不了）。
 */
describe("codemode extension", () => {
  let ctx: { dir: string; agentDir: string } | undefined;

  beforeEach(async () => {
    ctx = makeTempProject();
    codemodeConfig = normalizeCodemodeConfig(undefined);
    const { PiExtensionHost } =
      await import("../../main/extensions/pi-extension-host");
    PiExtensionHost.registry.clear();
  });

  afterEach(async () => {
    const { PiExtensionHost } =
      await import("../../main/extensions/pi-extension-host");
    for (const host of [...PiExtensionHost.registry.values()]) host.dispose();
    PiExtensionHost.registry.clear();
  });

  it("registers codemode but leaves it inactive by default (behavior unchanged)", async () => {
    const session = await buildSession(ctx!);

    // 已注册
    expect(session.getAllTools().map((tool) => tool.name)).toContain(
      "codemode",
    );
    // 未激活 —— 这是「默认关 ⇒ 行为零变化」的根据
    expect(session.getActiveToolNames()).not.toContain("codemode");
  }, 30000);
});
