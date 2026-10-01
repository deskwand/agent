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
  it("forces exposure=direct on every server (trap 1a: codemode would hide tools)", () => {
    upsertServer(agentDir, "notion", {
      type: "http",
      url: "https://mcp.notion.com/mcp",
    });
    const loaded = loadDeskwandMcpConfig(agentDir);
    expect(loaded.servers).toHaveLength(1);
    for (const server of loaded.servers) {
      expect(server.config.exposure).toBe("direct");
    }
  });

  it("disables autoEnableCodemode so codemode cannot be activated (trap 1b)", () => {
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
      autoEnableCodemode: false,
    });
  });

  it("defaults a raw standard config (no exposure) to direct", () => {
    // 用户从别的 MCP 客户端拷进来的标准配置不带 exposure；
    // SDK 默认 codemode 会让工具对模型完全不可见，且不报错。
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
    expect(loaded.servers[0].config.exposure).toBe("direct");
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

  it("defaults exposure for servers registered into an existing session", async () => {
    await withSession((registered) => {
      expect(
        activateDeskwandMcpServer("remote", {
          type: "http",
          url: "https://x/mcp",
        }),
      ).toBe(true);
      expect(registered[0].exposure).toBe("direct");
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
