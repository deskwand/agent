import { describe, expect, it, vi, beforeEach } from "vitest";
import { join } from "node:path";

// Chrome 就绪等待会真的去探测 9222 并尝试拉起 Chrome —— 测试里必须打桩。
const ensureChromeReady = vi.fn(async (_name: string) => {});
vi.mock("../../main/mcp/chrome-readiness", () => ({
  ensureChromeReady: (name: string) => ensureChromeReady(name),
  mcpServerNeedsChrome: (name: string) => /chrome|gui[_-]?operate/i.test(name),
}));

const FIXTURE = join(process.cwd(), "scripts/mcp-fixture-server.mjs");

function entry(name: string, command: string, args: string[]) {
  return {
    name,
    source: "deskwand",
    scope: "global" as const,
    config: {
      type: "stdio" as const,
      command,
      args,
      enabled: true,
      exposure: "direct" as const,
    },
  };
}

describe("mcp transport adapter", () => {
  beforeEach(async () => {
    ensureChromeReady.mockClear();
    const mod = await import("../../main/mcp/mcp-transport-adapter");
    mod.resetMcpServerStatesForTest();
  });

  it("connects a stdio server through pi-mcp's client and reaches connected", async () => {
    const { createDeskwandTransport, getMcpServerState } =
      await import("../../main/mcp/mcp-transport-adapter");
    const { McpClient } = await import("@earendil-works/pi-mcp");

    const transport = createDeskwandTransport(
      entry("fixture", process.execPath, [FIXTURE]),
      process.cwd(),
      undefined,
    );
    const client = new McpClient({ name: "adapter-test", version: "0" });
    await client.connect(transport);

    expect(getMcpServerState("fixture")).toBe("connected");
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom"]);

    await transport.close();
  });

  it("calls the Chrome readiness hook only for servers that need it", async () => {
    const { createDeskwandTransport } =
      await import("../../main/mcp/mcp-transport-adapter");

    const plain = createDeskwandTransport(
      entry("plain", process.execPath, [FIXTURE]),
      process.cwd(),
      undefined,
    );
    await plain.start();
    expect(ensureChromeReady).not.toHaveBeenCalled();
    await plain.close();

    const chromeish = createDeskwandTransport(
      entry("GUI_Operate", process.execPath, [FIXTURE]),
      process.cwd(),
      undefined,
    );
    await chromeish.start();
    expect(ensureChromeReady).toHaveBeenCalledTimes(1);
    expect(ensureChromeReady).toHaveBeenCalledWith("GUI_Operate");
    await chromeish.close();
  });

  it("records failed plus the message when the command cannot spawn", async () => {
    const { createDeskwandTransport, getMcpServerState, getMcpServerError } =
      await import("../../main/mcp/mcp-transport-adapter");

    const transport = createDeskwandTransport(
      entry("broken", "/definitely/not/here", []),
      process.cwd(),
      undefined,
    );
    await expect(transport.start()).rejects.toThrow();
    expect(getMcpServerState("broken")).toBe("failed");
    expect(getMcpServerError("broken")).toBeTruthy();
  });

  it("forwards setProtocolVersion to the delegate (remote servers need the version header)", async () => {
    const { createDeskwandTransport } =
      await import("../../main/mcp/mcp-transport-adapter");
    const transport = createDeskwandTransport(
      {
        name: "ver",
        source: "deskwand",
        scope: "global",
        config: {
          type: "http",
          url: "https://127.0.0.1:1/mcp",
          enabled: true,
          exposure: "direct",
        },
      },
      process.cwd(),
      undefined,
    );
    // 记录：调用不应抛错，且应在 start() 前后都能接受（上游会缓冲）
    expect(() => transport.setProtocolVersion?.("2024-11-05")).not.toThrow();
    await transport.start();
    expect(() => transport.setProtocolVersion?.("2024-11-05")).not.toThrow();
    await transport.close();
  });

  it("does not re-send a tools/call when the server answers with a structured Not-connected", async () => {
    const { createDeskwandTransport } =
      await import("../../main/mcp/mcp-transport-adapter");
    const { McpClient } = await import("@earendil-works/pi-mcp");

    const transport = createDeskwandTransport(
      entry("fixture", process.execPath, [FIXTURE]),
      process.cwd(),
      undefined,
    );
    const client = new McpClient({ name: "retry-test", version: "0" });
    await client.connect(transport);

    // boom 抛错、echo 正常；关键是**调用次数**。旧实现会在同一 id 下重发，
    // 导致上游丢弃重试结果、工具被执行两次（有副作用）——这里守住不再发生。
    const calls: string[] = [];
    const originalSend = transport.send.bind(transport);
    transport.send = (message) => {
      const method = (message as { method?: string }).method;
      if (method === "tools/call") calls.push(method);
      return originalSend(message);
    };

    // pi-mcp 把工具错误作为 isError 结果返回，而不是 reject
    const failed = await client.callTool("boom", {});
    expect((failed as { isError?: boolean }).isError).toBe(true);
    // 只发了一次 —— 没有在同 id 下重发
    expect(calls).toEqual(["tools/call"]);

    const echoed = await client.callTool("echo", { text: "x" });
    expect(JSON.stringify(echoed.content)).toContain("echo:x");
    expect(calls).toEqual(["tools/call", "tools/call"]);

    await transport.close();
  });

  it("leaves state at connecting for an unreachable http server, and maps a refused connection to failed", async () => {
    const { createDeskwandTransport, getMcpServerState } =
      await import("../../main/mcp/mcp-transport-adapter");
    const transport = createDeskwandTransport(
      {
        name: "authy",
        source: "deskwand",
        scope: "global",
        config: {
          type: "http",
          url: "https://127.0.0.1:1/mcp",
          enabled: true,
          exposure: "direct",
        },
      },
      process.cwd(),
      { token: async () => undefined },
    );

    // 实测事实：HTTP 传输在 start() **不建连**（Sent 时才连）—— 所以这里不 reject
    await transport.start();
    expect(getMcpServerState("authy")).toBe("connecting");

    // 失败在首次 send 时浮现；连接被拒属于 failed，不是 needs-auth
    // （needs-auth 只对应 401 / 403 / session expired）
    await expect(
      transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      } as never),
    ).rejects.toThrow();
    expect(getMcpServerState("authy")).toBe("failed");

    await transport.close();
  });
});
