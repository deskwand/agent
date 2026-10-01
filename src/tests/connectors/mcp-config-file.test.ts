import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  mcpConfigPath,
  readMcpConfig,
  upsertServer,
  removeServer,
  setServerEnabled,
} from "../../main/connectors/mcp-config-file";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpcfg-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function file(): {
  mcpServers: Record<string, Record<string, unknown>>;
} & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(mcpConfigPath(dir), "utf8"));
}

describe("readMcpConfig", () => {
  it("returns no servers when the file is missing", () => {
    expect(readMcpConfig(dir)).toEqual({ servers: [], errors: [] });
  });

  it("reads the mcpServers shape", () => {
    fs.writeFileSync(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          notion: { type: "http", url: "https://mcp.notion.com/mcp" },
        },
      }),
    );
    const out = readMcpConfig(dir);
    expect(out.servers).toHaveLength(1);
    expect(out.servers[0].name).toBe("notion");
    expect(out.servers[0].config).toEqual({
      type: "http",
      url: "https://mcp.notion.com/mcp",
    });
    expect(out.errors).toEqual([]);
  });

  it("reports invalid JSON instead of throwing", () => {
    fs.writeFileSync(mcpConfigPath(dir), "{ not json");
    const out = readMcpConfig(dir);
    expect(out.servers).toEqual([]);
    expect(out.errors[0]).toMatch(/invalid JSON/);
  });

  it("reports a non-object top level instead of throwing", () => {
    fs.writeFileSync(mcpConfigPath(dir), "[1,2,3]");
    const out = readMcpConfig(dir);
    expect(out.servers).toEqual([]);
    expect(out.errors[0]).toMatch(/must be an object/);
  });

  it("treats a missing mcpServers key as empty", () => {
    fs.writeFileSync(
      mcpConfigPath(dir),
      JSON.stringify({ autoEnableCodemode: false }),
    );
    expect(readMcpConfig(dir).servers).toEqual([]);
  });
});

describe("upsertServer", () => {
  it.each(["My Server", "my.server", "my/server", "通知机器人", ""])(
    "rejects an SDK-invalid server name: %s",
    (name) => {
      expect(() =>
        upsertServer(dir, name, { type: "http", url: "https://x/mcp" }),
      ).toThrow(/invalid server name/);
      expect(fs.existsSync(mcpConfigPath(dir))).toBe(false);
    },
  );

  it.each(["good-name", "good_name", "Name123", "Chrome", "a__b"])(
    "accepts an SDK-valid server name: %s",
    (name) => {
      expect(() =>
        upsertServer(dir, name, { type: "http", url: "https://x/mcp" }),
      ).not.toThrow();
    },
  );

  it("forces exposure=direct — codemode would hide tools silently", () => {
    upsertServer(dir, "notion", { type: "http", url: "https://x/mcp" });
    expect(file().mcpServers.notion.exposure).toBe("direct");
  });

  it("overrides an exposure the caller supplied", () => {
    upsertServer(dir, "notion", {
      type: "http",
      url: "https://x/mcp",
      exposure: "codemode",
    });
    expect(file().mcpServers.notion.exposure).toBe("direct");
  });

  it("creates the file and directory when missing", () => {
    const nested = path.join(dir, "deep", "nested");
    upsertServer(nested, "notion", { type: "http", url: "https://x/mcp" });
    expect(fs.existsSync(mcpConfigPath(nested))).toBe(true);
  });

  it("preserves unrelated top-level keys", () => {
    fs.writeFileSync(
      mcpConfigPath(dir),
      JSON.stringify({ autoEnableCodemode: false, mcpServers: {} }),
    );
    upsertServer(dir, "notion", { type: "http", url: "https://x/mcp" });
    expect(file().autoEnableCodemode).toBe(false);
  });

  it("replaces an existing entry of the same name", () => {
    upsertServer(dir, "notion", { type: "http", url: "https://old/mcp" });
    upsertServer(dir, "notion", { type: "http", url: "https://new/mcp" });
    expect(file().mcpServers.notion.url).toBe("https://new/mcp");
    expect(Object.keys(file().mcpServers)).toEqual(["notion"]);
  });

  it("keeps other servers untouched", () => {
    upsertServer(dir, "a", { type: "http", url: "https://a/mcp" });
    upsertServer(dir, "b", { type: "http", url: "https://b/mcp" });
    upsertServer(dir, "a", { type: "http", url: "https://a2/mcp" });
    expect(Object.keys(file().mcpServers).sort()).toEqual(["a", "b"]);
    expect(file().mcpServers.b.url).toBe("https://b/mcp");
  });

  it("supports stdio servers (keeps command/args/env)", () => {
    upsertServer(dir, "custom", {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { FOO: "bar" },
    });
    const written = file().mcpServers.custom;
    expect(written.command).toBe("node");
    expect(written.args).toEqual(["server.js"]);
    expect(written.env).toEqual({ FOO: "bar" });
    expect(written.exposure).toBe("direct");
  });
});

describe("removeServer", () => {
  it("removes only the named entry", () => {
    upsertServer(dir, "a", { type: "http", url: "https://a/mcp" });
    upsertServer(dir, "b", { type: "http", url: "https://b/mcp" });
    expect(removeServer(dir, "a")).toBe(true);
    expect(Object.keys(file().mcpServers)).toEqual(["b"]);
  });

  it("returns false for an unknown name", () => {
    expect(removeServer(dir, "nope")).toBe(false);
  });

  it("returns false when the file is missing", () => {
    expect(removeServer(dir, "nope")).toBe(false);
  });
});

describe("setServerEnabled", () => {
  it("toggles enabled without touching other fields", () => {
    upsertServer(dir, "chrome", { type: "stdio", command: "npx" });
    expect(setServerEnabled(dir, "chrome", false)).toBe(true);
    expect(file().mcpServers.chrome.enabled).toBe(false);
    expect(file().mcpServers.chrome.command).toBe("npx");
  });

  it("can re-enable", () => {
    upsertServer(dir, "chrome", { type: "stdio", command: "npx" });
    setServerEnabled(dir, "chrome", false);
    setServerEnabled(dir, "chrome", true);
    expect(file().mcpServers.chrome.enabled).toBe(true);
  });

  it("returns false for an unknown name", () => {
    expect(setServerEnabled(dir, "nope", false)).toBe(false);
  });
});

describe("refuses to clobber a broken file", () => {
  it("upsertServer throws instead of overwriting invalid JSON", () => {
    fs.writeFileSync(mcpConfigPath(dir), "{ broken");
    expect(() =>
      upsertServer(dir, "notion", { type: "http", url: "https://x/mcp" }),
    ).toThrow(/refusing to overwrite/);
    // 原文件保持原样，用户的配置还在
    expect(fs.readFileSync(mcpConfigPath(dir), "utf8")).toBe("{ broken");
  });

  it("removeServer reports failure instead of rewriting invalid JSON", () => {
    fs.writeFileSync(mcpConfigPath(dir), "{ broken");
    expect(removeServer(dir, "notion")).toBe(false);
    expect(fs.readFileSync(mcpConfigPath(dir), "utf8")).toBe("{ broken");
  });

  it("setServerEnabled reports failure instead of rewriting invalid JSON", () => {
    fs.writeFileSync(mcpConfigPath(dir), "{ broken");
    expect(setServerEnabled(dir, "notion", false)).toBe(false);
    expect(fs.readFileSync(mcpConfigPath(dir), "utf8")).toBe("{ broken");
  });
});
