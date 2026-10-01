import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadDeskwandMcpConfig,
  setMcpAgentDir,
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
});
