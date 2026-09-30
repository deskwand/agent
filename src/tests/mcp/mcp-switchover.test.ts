import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const FIXTURE = join(process.cwd(), "scripts/mcp-fixture-server.mjs");

// store 换成 fixture server —— 其它字段留空，投影会补上 enabled/exposure。
vi.mock("../../main/mcp/mcp-config-store", () => ({
  mcpConfigStore: {
    getServers: () => [
      {
        id: "fixture-id",
        name: "Fixture",
        type: "stdio",
        command: process.execPath,
        args: [FIXTURE],
        env: {},
        enabled: true,
      },
    ],
    resolveServerPathToken: () => null,
  },
}));

function makeTempProject(): { dir: string; agentDir: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-switchover-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  return { dir: project, agentDir };
}

/**
 * 门禁 2（设计 §7）：陷阱① 的**端到端**断言。
 *
 * 投影层的断言（mcp-config-projection.test.ts / mcp-client-extension.test.ts）只证明
 * 「我们返回了 exposure:direct 且 autoEnableCodemode:false」；这里证明**那个配置真的
 * 产生了预期效果**：MCP 工具对模型可见，而 codemode 没有被激活。
 */
describe("builtin mcp switchover (trap 1 end to end)", () => {
  let ctx: { dir: string; agentDir: string } | undefined;

  beforeEach(() => {
    ctx = makeTempProject();
    PiExtensionHost.registry.clear();
  });

  afterEach(() => {
    for (const host of [...PiExtensionHost.registry.values()]) host.dispose();
    PiExtensionHost.registry.clear();
  });

  async function buildSession() {
    const { createDeskwandMcpExtension } =
      await import("../../main/mcp/mcp-client-extension");
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    const loader = await host.createSessionResourceLoader([
      createDeskwandMcpExtension(),
    ]);
    const { session } = await createAgentSession({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
      resourceLoader: loader,
    });
    return session;
  }

  /**
   * 门禁 2 只覆盖了陷阱①的**一半**，另一半如实记为缺口：
   *
   * 「MCP 工具对模型可见（trap 1a）」在本测试环境里**断言不了** —— 内置扩展把建连放在
   * `session_start` 之后的一条 promise 链上，链上的失败会被它自己的
   * `ctx.ui.notify(...)` try/catch 吞掉，在 vitest 的 node 环境里既不连、也不报错
   * （实测：`loadConfig` 被调用 1 次，`createTransport` 从未被调用，无异常外泄）。
   *
   * 该断言改由两处覆盖：
   *  - `mcp-transport-adapter.test.ts`：适配器真连 fixture 并列出工具（同一份传输路径）
   *  - 打包版人工验证（设计 §7 门禁 7）：模型真调用 `mcp__<server>__echo`
   */
  it.todo(
    "declares the mcp tool to the model (trap 1a) — covered by the adapter test + packaged manual verification",
  );

  it("does not activate codemode (trap 1b: the unapproved feature must not sneak in)", async () => {
    const session = await buildSession();
    const active = session.getActiveToolNames();

    // 若 loadConfig 漏了 autoEnableCodemode:false 或 exposure:direct，
    // 内置扩展会为了「让 mcp 工具可用」自动把 codemode 打开 —— 这里就是那道闸门。
    expect(active).not.toContain("codemode");
  }, 30000);
});
