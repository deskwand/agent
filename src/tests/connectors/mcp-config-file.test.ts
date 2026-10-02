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

  it("leaves exposure unset — upstream defaults to codemode", () => {
    upsertServer(dir, "notion", { type: "http", url: "https://x/mcp" });
    expect(file().mcpServers.notion).not.toHaveProperty("exposure");
  });

  it("preserves an exposure the caller supplied", () => {
    upsertServer(dir, "notion", {
      type: "http",
      url: "https://x/mcp",
      exposure: "codemode",
    });
    expect(file().mcpServers.notion.exposure).toBe("codemode");
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
    expect(written).not.toHaveProperty("exposure");
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

describe("upsertServer rename (previousName)", () => {
  it("renames an existing server in a single write", () => {
    upsertServer(dir, "old-name", { type: "http", url: "https://x/mcp" });
    upsertServer(
      dir,
      "new-name",
      { type: "http", url: "https://x/mcp" },
      "old-name",
    );
    expect(Object.keys(file().mcpServers)).toEqual(["new-name"]);
  });

  it("rejects a rename that would overwrite an unrelated server", () => {
    upsertServer(dir, "a", { type: "http", url: "https://a/mcp" });
    upsertServer(dir, "b", { type: "http", url: "https://b/mcp" });
    const before = fs.readFileSync(mcpConfigPath(dir), "utf8");
    expect(() =>
      upsertServer(dir, "b", { type: "http", url: "https://renamed/mcp" }, "a"),
    ).toThrow(/already exists/);
    // 冲突时必须原地退出，不能把 a 或 b 覆盖掉
    expect(fs.readFileSync(mcpConfigPath(dir), "utf8")).toBe(before);
  });

  it("treats previousName equal to name as a plain update", () => {
    upsertServer(dir, "a", { type: "http", url: "https://old/mcp" });
    upsertServer(dir, "a", { type: "http", url: "https://new/mcp" }, "a");
    expect(file().mcpServers.a.url).toBe("https://new/mcp");
    expect(Object.keys(file().mcpServers)).toEqual(["a"]);
  });

  it("ignores a previousName that is not in the file", () => {
    upsertServer(
      dir,
      "fresh",
      { type: "http", url: "https://x/mcp" },
      "never-existed",
    );
    expect(Object.keys(file().mcpServers)).toEqual(["fresh"]);
  });
});

describe("upsertServer partial saves", () => {
  it("keeps SDK/options fields when the transport is unchanged", () => {
    upsertServer(dir, "remote", {
      type: "http",
      url: "https://x/mcp",
      oauth: { clientId: "abc" },
      timeout: 30,
    });
    // 相当于设置页 toggle enabled 时发来的部分配置：只有表单字段
    upsertServer(dir, "remote", {
      type: "http",
      url: "https://x/mcp",
      enabled: false,
      exposure: "direct",
    });
    const written = file().mcpServers.remote;
    expect(written.enabled).toBe(false);
    expect(written.oauth).toEqual({ clientId: "abc" });
    expect(written.timeout).toBe(30);
  });

  it("drops the old transport's fields when the transport changes", () => {
    upsertServer(dir, "switch", {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { A: "1" },
    });
    upsertServer(dir, "switch", { type: "http", url: "https://x/mcp" });
    const written = file().mcpServers.switch;
    expect(written.url).toBe("https://x/mcp");
    expect(written.command).toBeUndefined();
    expect(written.args).toBeUndefined();
    expect(written.env).toBeUndefined();
  });

  it("drops http fields when switching to stdio", () => {
    upsertServer(dir, "switch", {
      type: "http",
      url: "https://x/mcp",
      headers: { Authorization: "Bearer t" },
    });
    upsertServer(dir, "switch", { type: "stdio", command: "node" });
    const written = file().mcpServers.switch;
    expect(written.command).toBe("node");
    expect(written.url).toBeUndefined();
    expect(written.headers).toBeUndefined();
  });

  it("keeps options fields across a rename with the same transport", () => {
    upsertServer(dir, "before", {
      type: "http",
      url: "https://x/mcp",
      oauth: { clientId: "abc" },
    });
    upsertServer(
      dir,
      "after",
      { type: "http", url: "https://x/mcp" },
      "before",
    );
    expect(file().mcpServers.after.oauth).toEqual({ clientId: "abc" });
  });
});

describe("advanced settings field removal", () => {
  it("clears removed arguments and environment while keeping unmodeled options", () => {
    upsertServer(dir, "local", {
      type: "stdio",
      command: "node",
      args: ["old.js"],
      env: { OLD_TOKEN: "secret" },
      cwd: "/workspace",
      timeout: 30,
    });
    // 表单省略 args/env ⇒ 显式 undefined 覆盖旧值（落盘时移除）
    upsertServer(dir, "local", {
      type: "stdio",
      command: "node",
      args: undefined,
      env: undefined,
      enabled: true,
    });
    const saved = file().mcpServers.local;
    expect(saved.args).toBeUndefined();
    expect(saved.env).toBeUndefined();
    expect(saved.cwd).toBe("/workspace");
    expect(saved.timeout).toBe(30);
  });
});

describe("atomic write", () => {
  it("keeps the previous config and no temp file when the write fails", () => {
    upsertServer(dir, "a", { type: "http", url: "https://a/mcp" });
    const before = fs.readFileSync(mcpConfigPath(dir), "utf8");

    fs.chmodSync(dir, 0o500);
    try {
      expect(() =>
        upsertServer(dir, "b", { type: "http", url: "https://b/mcp" }),
      ).toThrow();
    } finally {
      fs.chmodSync(dir, 0o700);
    }

    expect(fs.readFileSync(mcpConfigPath(dir), "utf8")).toBe(before);
    expect(
      fs.readdirSync(dir).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });
});
