import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type {
  ExtensionAPI,
  McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadDeskwandMcpConfig,
  setMcpAgentDir,
  activateDeskwandMcpServer,
  createDeskwandMcpExtension,
} from "../../main/mcp/mcp-client-extension";
import {
  mcpConfigPath,
  upsertServer,
} from "../../main/connectors/mcp-config-file";

let agentDir: string;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpext-"));
  setMcpAgentDir(agentDir);
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("builtin mcp extension assembly", () => {
  it("leaves exposure unset so upstream defaults to codemode", () => {
    // 原先这里断言强制 "direct"（避免工具对模型不可见）。现在跟随 pi 的参考实现：
    // 不写该键 ⇒ 上游 `exposureOf` 取 `codemode`，并由它派生激活 codemode。
    upsertServer(agentDir, "notion", {
      type: "http",
      url: "https://mcp.notion.com/mcp",
    });
    const loaded = loadDeskwandMcpConfig(agentDir);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0].config).not.toHaveProperty("exposure");
  });

  it("does not set autoEnableCodemode (upstream default true applies)", () => {
    expect(loadDeskwandMcpConfig(agentDir)).not.toHaveProperty(
      "autoEnableCodemode",
    );
  });

  it("passes through autoEnableCodemode from the top level of mcp.json", () => {
    // pi 的全局 opt-out（docs/mcp.md:154）。原先这个键被 readMcpConfig 丢掉 ⇒ 静默忽略。
    fs.writeFileSync(
      mcpConfigPath(agentDir),
      JSON.stringify({ mcpServers: {}, autoEnableCodemode: false }),
    );
    expect(loadDeskwandMcpConfig(agentDir).autoEnableCodemode).toBe(false);
  });

  it("keeps server names byte-identical (they become mcp__<server>__<tool>)", () => {
    upsertServer(agentDir, "Software_Development", {
      type: "stdio",
      command: "node",
    });
    const names = loadDeskwandMcpConfig(agentDir).servers.map((s) => s.name);
    expect(names).toEqual(["Software_Development"]);
  });

  it("keeps double underscores verbatim — the old sanitizer would have collapsed them", () => {
    // 旧的 sanitizeMcpServerKey 会把 "a__b" 改成 "a_b"；新路径必须原样保留，
    // 因为改名字就变更 mcp__<server>__<tool>，破坏提示词缓存。
    // （名字用 a__b 而非 "My Server"：后者含空格，SDK 会直接拒收，
    //   现在在写入前就被 isValidServerName 拦下了。）
    upsertServer(agentDir, "a__b", { type: "http", url: "https://x/mcp" });
    expect(loadDeskwandMcpConfig(agentDir).servers[0].name).toBe("a__b");
  });

  it("rejects a name the SDK would refuse, rather than writing a dead entry", () => {
    expect(() =>
      upsertServer(agentDir, "My Server", {
        type: "http",
        url: "https://x/mcp",
      }),
    ).toThrow(/invalid server name/);
  });

  it("surfaces mcp.json parse errors instead of throwing", () => {
    fs.writeFileSync(mcpConfigPath(agentDir), "{ broken");
    const loaded = loadDeskwandMcpConfig(agentDir);
    expect(loaded.servers).toEqual([]);
    expect(loaded.errors.length).toBeGreaterThan(0);
  });

  it("returns an empty server list when mcp.json is absent", () => {
    expect(loadDeskwandMcpConfig(agentDir)).toEqual({
      servers: [],
      errors: [],
    });
  });

  it("leaves a raw standard config (no exposure) untouched", () => {
    // 用户从别的 MCP 客户端拷进来的标准配置不带 exposure ⇒ 取上游默认 codemode。
    fs.writeFileSync(
      mcpConfigPath(agentDir),
      JSON.stringify({
        mcpServers: {
          notion: { type: "http", url: "https://mcp.notion.com/mcp" },
        },
      }),
    );
    const loaded = loadDeskwandMcpConfig(agentDir);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0].config).not.toHaveProperty("exposure");
  });

  it("retains an exposure the user wrote explicitly", () => {
    fs.writeFileSync(
      mcpConfigPath(agentDir),
      JSON.stringify({
        mcpServers: {
          notion: {
            type: "http",
            url: "https://mcp.notion.com/mcp",
            exposure: "deferred",
          },
        },
      }),
    );
    const loaded = loadDeskwandMcpConfig(agentDir);
    expect(loaded.servers[0].config.exposure).toBe("deferred");
  });
});

describe("immediate MCP activation", () => {
  async function withSession(check: (registered: McpServerConfig[]) => void) {
    const registered: McpServerConfig[] = [];
    const shutdown: Array<() => void> = [];
    const api = {
      on: (event: string, handler: () => void) => {
        if (event === "session_shutdown") shutdown.push(handler);
      },
      registerCommand: vi.fn(),
      // pi-coding-agent 1.0.1 新增；上游内置 MCP 扩展在注册时就会调它
      // （`dist/extensions/mcp/index.js:280`），缺了会 TypeError。
      registerToolRenderer: vi.fn(),
      getAllTools: () => [],
      registerMcpServer: (_name: string, config: McpServerConfig) =>
        registered.push(config),
    } as unknown as ExtensionAPI;
    await createDeskwandMcpExtension()(api);
    try {
      check(registered);
    } finally {
      for (const handler of shutdown) handler();
    }
  }

  it("leaves exposure unset for servers registered into an existing session", async () => {
    await withSession((registered) => {
      expect(
        activateDeskwandMcpServer("remote", {
          type: "http",
          url: "https://x/mcp",
        }),
      ).toBe(true);
      expect(registered[0]).not.toHaveProperty("exposure");
    });
  });

  it("retains explicit exposure during immediate activation", async () => {
    await withSession((registered) => {
      activateDeskwandMcpServer("remote", {
        type: "http",
        url: "https://x/mcp",
        exposure: "deferred",
      });
      expect(registered[0].exposure).toBe("deferred");
    });
  });
});

describe("transport path projection", () => {
  it("rewrites a bare node/npx command to the bundled binaries", async () => {
    const { getBundledNodePath } =
      await import("../../main/mcp/mcp-server-paths");
    const bundled = getBundledNodePath();
    // 打包环境才有打包 node；开发环境可能没有 —— 那就不该断言改写结果。
    if (!bundled) return;

    for (const [input, expected] of [
      ["node", bundled.node],
      ["npx", bundled.npx],
    ] as const) {
      upsertServer(agentDir, "proj", {
        type: "stdio",
        command: input,
        args: ["x"],
      });
      const config = loadDeskwandMcpConfig(agentDir).servers[0].config as {
        command?: string;
      };
      expect(config.command).toBe(expected);
    }
  });

  it("injects env.PATH even when the server declares no env at all", async () => {
    const { getBundledNodePath } =
      await import("../../main/mcp/mcp-server-paths");
    const bundled = getBundledNodePath();
    if (!bundled) return;

    upsertServer(agentDir, "proj", { type: "stdio", command: "npx" });
    const config = loadDeskwandMcpConfig(agentDir).servers[0].config as {
      env?: Record<string, string>;
    };
    // 这条注入的意义就在「没有 env 的 server」（绝大多数）—— 所以必须造出 env 来
    expect(config.env?.PATH).toBeTruthy();
    expect(config.env?.PATH?.split(":").at(0)).toBe(
      bundled.node.replace(/\/node$/, ""),
    );
  });

  it("keeps an explicit PATH the user wrote", () => {
    upsertServer(agentDir, "proj", {
      type: "stdio",
      command: "npx",
      env: { PATH: "/custom/bin" },
    });
    const config = loadDeskwandMcpConfig(agentDir).servers[0].config as {
      env?: Record<string, string>;
    };
    expect(config.env?.PATH).toBe("/custom/bin");
  });

  it("leaves http servers untouched", () => {
    upsertServer(agentDir, "proj", { type: "http", url: "https://x/mcp" });
    const config = loadDeskwandMcpConfig(agentDir).servers[0].config as {
      env?: unknown;
    };
    expect(config).not.toHaveProperty("env");
  });
});
